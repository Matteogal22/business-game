// Logica di gioco su database: creazione partita, macchina a stati, timer, round, calcolo KPI.
const { db, log } = require('./db');
const { randomCode, formatCode } = require('./auth');
const { DEFAULT_PARAMS, DEFAULT_EVENTS, SEGMENTS, MARKETS, CHANNELS, CATEGORIES } = require('./defaults');
const { simulateRound } = require('./simulation');

class GameError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

// ---------- validazione ----------
const str = (v, max, { required = false, label = 'campo' } = {}) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (required && !s) throw new GameError(`Il ${label} è obbligatorio.`);
  if (s.length > max) throw new GameError(`Il ${label} è troppo lungo (max ${max} caratteri).`);
  return s;
};
const num = (v, min, max, label, { int = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new GameError(`${label}: valore non valido (tra ${min} e ${max}).`);
  return int ? Math.round(n) : n;
};
const oneOf = (v, list, label) => { if (!list.includes(v)) throw new GameError(`${label} non valido.`); return v; };

function validateDecision(body) {
  return {
    price: num(body.price, 10, 50000, 'Prezzo'),
    production: num(body.production, 0, 200000, 'Produzione', { int: true }),
    marketing: num(body.marketing, 0, 2000000, 'Marketing', { int: true }),
    design: num(body.design, 0, 2000000, 'Design / R&D', { int: true }),
    sustainability: num(body.sustainability, 0, 2000000, 'Sostenibilità', { int: true }),
    channel: oneOf(body.channel, CHANNELS, 'Canale'),
    notes: str(body.notes, 500, { label: 'motivazione' }),
  };
}

function validateStartup(body) {
  return {
    name: str(body.name, 60, { required: true, label: 'nome della startup' }),
    segment: oneOf(body.segment, SEGMENTS, 'Segmento'),
    category: oneOf(body.category, CATEGORIES, 'Categoria'),
    market: oneOf(body.market, MARKETS, 'Mercato'),
    positioning: str(body.positioning, 400, { label: 'posizionamento' }),
    values_text: str(body.values_text, 400, { label: 'valori' }),
  };
}

// Il docente può modificare i parametri: si accettano solo chiavi note e valori numerici in range.
function validateParams(input, base = DEFAULT_PARAMS) {
  const p = JSON.parse(JSON.stringify(base));
  const i = input || {};
  const set = (obj, key, src, min, max, label) => { if (src !== undefined && src !== '') obj[key] = num(src, min, max, label); };
  set(p, 'startingCash', i.startingCash, 0, 1e9, 'Cassa iniziale');
  set(p, 'fixedCostPerRound', i.fixedCostPerRound, 0, 1e8, 'Costi fissi');
  set(p, 'outsideOption', i.outsideOption, 0, 100, 'Difficoltà mercato');
  set(p, 'sustainabilityPreference', i.sustainabilityPreference, 0, 2, 'Sensibilità sostenibilità');
  set(p, 'holdingCostRate', i.holdingCostRate, 0, 2, 'Costo magazzino');
  for (const k of ['brand', 'quality', 'sustainability']) {
    if (i.start) set(p.start, k, i.start[k], 0, 100, `Valore iniziale ${k}`);
    if (i.decay) set(p.decay, k, i.decay[k], 0, 1, `Erosione ${k}`);
  }
  for (const s of SEGMENTS) {
    const src = i.segments && i.segments[s];
    if (!src) continue;
    set(p.segments[s], 'refPrice', src.refPrice, 1, 100000, `Prezzo di riferimento ${s}`);
    set(p.segments[s], 'elasticity', src.elasticity, 0, 5, `Elasticità ${s}`);
    set(p.segments[s], 'baseDemand', src.baseDemand, 0, 1e7, `Domanda base ${s}`);
    set(p.segments[s], 'unitCost', src.unitCost, 0, 100000, `Costo unitario ${s}`);
  }
  for (const m of MARKETS) {
    const src = i.markets && i.markets[m];
    if (src) set(p.markets[m], 'demandWeight', src.demandWeight, 0, 10, `Peso mercato ${m}`);
  }
  if (i.scoreWeights) for (const k of Object.keys(p.scoreWeights)) set(p.scoreWeights, k, i.scoreWeights[k], 0, 10, `Peso ${k}`);
  return p;
}

function validateEvent(body) {
  const e = body.effects || {};
  const effects = {};
  const mapNums = (src, keys, min, max, label) => {
    if (!src) return undefined;
    const out = {};
    for (const k of keys) if (src[k] !== undefined && src[k] !== '' && src[k] !== null) out[k] = num(src[k], min, max, `${label} ${k}`);
    return Object.keys(out).length ? out : undefined;
  };
  const dm = mapNums(e.demandByMarket, MARKETS, 0, 5, 'Domanda');
  const ds = mapNums(e.demandBySegment, SEGMENTS, 0, 5, 'Domanda');
  const tm = mapNums(e.tariffByMarket, MARKETS, -1, 2, 'Dazio');
  if (dm) effects.demandByMarket = dm;
  if (ds) effects.demandBySegment = ds;
  if (tm) effects.tariffByMarket = tm;
  if (e.costMultiplier !== undefined && e.costMultiplier !== '') effects.costMultiplier = num(e.costMultiplier, 0.1, 5, 'Moltiplicatore costi');
  if (e.lowSustainabilityBrandShock !== undefined && e.lowSustainabilityBrandShock !== '') effects.lowSustainabilityBrandShock = num(e.lowSustainabilityBrandShock, -50, 50, 'Shock brand');
  if (e.sustainabilityPreferenceDelta !== undefined && e.sustainabilityPreferenceDelta !== '') effects.sustainabilityPreferenceDelta = num(e.sustainabilityPreferenceDelta, -2, 2, 'Sensibilità green');
  return {
    title: str(body.title, 100, { required: true, label: 'titolo' }),
    description: str(body.description, 600, { label: 'descrizione' }),
    effects,
  };
}

// ---------- creazione ----------
function uniqueCode() {
  for (let i = 0; i < 20; i++) {
    const c = randomCode(8);
    if (!db.prepare('SELECT 1 FROM access_codes WHERE code = ?').get(c)) return c;
  }
  throw new GameError('Impossibile generare un codice univoco.', 500);
}

function createGame(teacherId, body) {
  const name = str(body.name, 100, { required: true, label: 'nome della sessione' });
  const numSessions = num(body.numSessions ?? 3, 1, 10, 'Numero sessioni', { int: true });
  const sessionMinutes = num(body.sessionMinutes ?? 90, 10, 600, 'Durata sessione', { int: true });
  const numRounds = num(body.numRounds ?? 6, 1, 30, 'Numero round', { int: true });
  const leaderboardPublic = body.leaderboardPublic === false || body.leaderboardPublic === 'false' ? 0 : 1;
  const params = validateParams(body.params);

  const tx = db.transaction(() => {
    const { lastInsertRowid: gameId } = db.prepare(`INSERT INTO games (owner_id, name, num_sessions, session_minutes, num_rounds, leaderboard_public, params_json)
      VALUES (?,?,?,?,?,?,?)`).run(teacherId, name, numSessions, sessionMinutes, numRounds, leaderboardPublic, JSON.stringify(params));
    db.prepare('INSERT INTO game_state (game_id, status, updated_at) VALUES (?, \'setup\', ?)').run(gameId, Date.now());
    for (let n = 1; n <= numSessions; n++) db.prepare('INSERT INTO class_sessions (game_id, number, status) VALUES (?,?,\'pending\')').run(gameId, n);
    db.prepare('INSERT INTO access_codes (game_id, code, status) VALUES (?,?,\'active\')').run(gameId, uniqueCode());
    for (const e of DEFAULT_EVENTS) {
      db.prepare('INSERT INTO events (game_id, title, description, effects_json, custom) VALUES (?,?,?,?,0)').run(gameId, e.title, e.description, JSON.stringify(e.effects));
    }
    log(gameId, `docente:${teacherId}`, 'Partita creata');
    return Number(gameId);
  });
  return tx();
}

function updateGame(game, body) {
  const st = getStateRow(game.id);
  const fields = {};
  if (body.name !== undefined) fields.name = str(body.name, 100, { required: true, label: 'nome della sessione' });
  if (body.sessionMinutes !== undefined) fields.session_minutes = num(body.sessionMinutes, 10, 600, 'Durata sessione', { int: true });
  if (body.numRounds !== undefined) {
    const n = num(body.numRounds, 1, 30, 'Numero round', { int: true });
    if (n < st.current_round) throw new GameError('Il numero di round non può essere inferiore ai round già giocati.');
    fields.num_rounds = n;
  }
  if (body.leaderboardPublic !== undefined) fields.leaderboard_public = body.leaderboardPublic === true || body.leaderboardPublic === 'true' ? 1 : 0;
  if (body.params !== undefined) fields.params_json = JSON.stringify(validateParams(body.params, JSON.parse(game.params_json)));
  if (body.numSessions !== undefined) {
    const n = num(body.numSessions, 1, 10, 'Numero sessioni', { int: true });
    if (n < Math.max(1, st.current_session)) throw new GameError('Non puoi eliminare sessioni già iniziate.');
    fields.num_sessions = n;
  }
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.transaction(() => {
    db.prepare(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => fields[k]), game.id);
    if (fields.num_sessions) {
      db.prepare('DELETE FROM class_sessions WHERE game_id = ? AND number > ? AND status = \'pending\'').run(game.id, fields.num_sessions);
      for (let n = 1; n <= fields.num_sessions; n++) db.prepare('INSERT OR IGNORE INTO class_sessions (game_id, number, status) VALUES (?,?,\'pending\')').run(game.id, n);
    }
    log(game.id, 'docente', 'Impostazioni modificate');
  })();
}

// ---------- stato e timer ----------
const getStateRow = (gameId) => db.prepare('SELECT * FROM game_state WHERE game_id = ?').get(gameId);
const setState = (gameId, patch) => {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE game_state SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE game_id = ?`)
    .run(...keys.map((k) => patch[k]), Date.now(), gameId);
};
const sessionElapsed = (s) => s.elapsed_ms + (s.status === 'running' && s.running_since ? Date.now() - s.running_since : 0);

function stopClock(gameId, number, newStatus) {
  const s = db.prepare('SELECT * FROM class_sessions WHERE game_id = ? AND number = ?').get(gameId, number);
  if (!s) return;
  db.prepare('UPDATE class_sessions SET status = ?, elapsed_ms = ?, running_since = NULL, closed_at = CASE WHEN ? = \'closed\' THEN ? ELSE closed_at END WHERE id = ?')
    .run(newStatus, sessionElapsed(s), newStatus, Date.now(), s.id);
}
function startClock(gameId, number) {
  db.prepare('UPDATE class_sessions SET status = \'running\', running_since = ?, started_at = COALESCE(started_at, ?), closed_at = NULL WHERE game_id = ? AND number = ?')
    .run(Date.now(), Date.now(), gameId, number);
}

function publicState(game) {
  const st = getStateRow(game.id);
  const cs = st.current_session ? db.prepare('SELECT * FROM class_sessions WHERE game_id = ? AND number = ?').get(game.id, st.current_session) : null;
  const openRound = db.prepare('SELECT * FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id);
  const elapsed = cs ? sessionElapsed(cs) : 0;
  return {
    status: st.status,
    currentSession: st.current_session,
    numSessions: game.num_sessions,
    currentRound: st.current_round,
    numRounds: game.num_rounds,
    roundOpen: !!openRound,
    sessionMinutes: game.session_minutes,
    elapsedMs: elapsed,
    remainingMs: Math.max(0, game.session_minutes * 60000 - elapsed),
    clockRunning: !!(cs && cs.status === 'running'),
    serverTime: Date.now(),
  };
}

// ---------- transizioni (solo docente) ----------
function transition(game, action) {
  const st = getStateRow(game.id);
  const tx = db.transaction(() => {
    switch (action) {
      case 'start': { // avvia la prossima sessione d'aula
        if (!['setup', 'session_closed'].includes(st.status)) throw new GameError('Puoi avviare una nuova sessione solo dopo aver chiuso quella in corso.');
        if (st.current_session >= game.num_sessions) throw new GameError('Tutte le sessioni previste sono già state svolte.');
        const n = st.current_session + 1;
        startClock(game.id, n);
        setState(game.id, { status: 'running', current_session: n });
        log(game.id, 'docente', `Sessione ${n} avviata`);
        break;
      }
      case 'pause':
        if (st.status !== 'running') throw new GameError('La sessione non è in corso.');
        stopClock(game.id, st.current_session, 'paused');
        setState(game.id, { status: 'paused' });
        log(game.id, 'docente', `Sessione ${st.current_session} in pausa`);
        break;
      case 'resume':
        if (st.status !== 'paused') throw new GameError('La sessione non è in pausa.');
        startClock(game.id, st.current_session);
        setState(game.id, { status: 'running' });
        log(game.id, 'docente', `Sessione ${st.current_session} ripresa`);
        break;
      case 'close':
        if (!['running', 'paused'].includes(st.status)) throw new GameError('Nessuna sessione aperta da chiudere.');
        stopClock(game.id, st.current_session, 'closed');
        setState(game.id, { status: 'session_closed' });
        log(game.id, 'docente', `Sessione ${st.current_session} chiusa`);
        break;
      case 'reopen': // riapre l'ultima sessione chiusa (es. chiusa per errore o da continuare)
        if (!['session_closed', 'debrief'].includes(st.status) || st.current_session < 1) throw new GameError('Non c\'è una sessione chiusa da riaprire.');
        startClock(game.id, st.current_session);
        setState(game.id, { status: 'running' });
        log(game.id, 'docente', `Sessione ${st.current_session} riaperta`);
        break;
      case 'debrief':
        if (['setup', 'ended'].includes(st.status)) throw new GameError('Il debriefing è disponibile solo durante o dopo il gioco.');
        if (db.prepare('SELECT 1 FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id)) throw new GameError('Chiudi e calcola il round aperto prima del debriefing.');
        if (st.current_session) stopClock(game.id, st.current_session, 'closed');
        setState(game.id, { status: 'debrief' });
        log(game.id, 'docente', 'Debriefing avviato');
        break;
      case 'end':
        if (st.status === 'ended') throw new GameError('La partita è già terminata.');
        if (db.prepare('SELECT 1 FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id)) throw new GameError('Chiudi e calcola il round aperto prima di terminare.');
        if (st.current_session) stopClock(game.id, st.current_session, 'closed');
        setState(game.id, { status: 'ended' });
        db.prepare('UPDATE access_codes SET status = \'expired\' WHERE game_id = ? AND status = \'active\'').run(game.id);
        log(game.id, 'docente', 'Partita terminata, codice scaduto');
        break;
      default: throw new GameError('Azione non riconosciuta.');
    }
  });
  tx();
}

// ---------- round ----------
function openRound(game, eventIds) {
  const st = getStateRow(game.id);
  if (st.status !== 'running') throw new GameError('Avvia (o riprendi) la sessione prima di aprire un round.');
  if (db.prepare('SELECT 1 FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id)) throw new GameError('C\'è già un round aperto.');
  if (st.current_round >= game.num_rounds) throw new GameError('Tutti i round previsti sono stati giocati. Puoi aumentarne il numero nelle impostazioni.');
  const ids = Array.isArray(eventIds) ? eventIds.map(Number).filter(Number.isInteger) : [];
  db.transaction(() => {
    const n = st.current_round + 1;
    const { lastInsertRowid: roundId } = db.prepare('INSERT INTO rounds (game_id, number, session_number, status, opened_at) VALUES (?,?,?,\'open\',?)')
      .run(game.id, n, st.current_session, Date.now());
    for (const id of ids) {
      const ev = db.prepare('SELECT * FROM events WHERE id = ? AND game_id = ?').get(id, game.id); // solo eventi di QUESTA partita
      if (!ev) throw new GameError('Evento non valido.');
      db.prepare('INSERT INTO round_events (round_id, event_id, snapshot_json) VALUES (?,?,?)')
        .run(roundId, id, JSON.stringify({ title: ev.title, description: ev.description, effects: JSON.parse(ev.effects_json) }));
    }
    setState(game.id, { current_round: n });
    log(game.id, 'docente', `Round ${n} aperto`);
  })();
}

function prevStateFor(game, groupId, params) {
  const last = db.prepare(`SELECT k.* FROM kpis k JOIN rounds r ON r.id = k.round_id
                           WHERE k.group_id = ? AND r.game_id = ? ORDER BY r.number DESC LIMIT 1`).get(groupId, game.id);
  if (last) return { cash: last.cash, brand: last.brand, quality: last.quality, sustainability: last.sustainability, inventory: last.inventory, cumProfit: last.cum_profit };
  return { cash: params.startingCash, brand: params.start.brand, quality: params.start.quality, sustainability: params.start.sustainability, inventory: 0, cumProfit: 0 };
}

function defaultDecision(game, groupId, startup, params, groupsCount) {
  const prev = db.prepare(`SELECT d.payload_json FROM decisions d JOIN rounds r ON r.id = d.round_id
                           WHERE d.group_id = ? AND r.game_id = ? ORDER BY r.number DESC LIMIT 1`).get(groupId, game.id);
  if (prev) return { ...JSON.parse(prev.payload_json), notes: '(decisione ripetuta automaticamente)' };
  const seg = params.segments[startup.segment];
  return {
    price: seg.refPrice, production: Math.round(seg.baseDemand / (groupsCount + 1)),
    marketing: 20000, design: 15000, sustainability: 10000, channel: 'ecommerce', notes: '(decisione automatica)',
  };
}

function closeRound(game) {
  const round = db.prepare('SELECT * FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id);
  if (!round) throw new GameError('Nessun round aperto.');
  const params = JSON.parse(game.params_json);
  const groups = db.prepare(`SELECT g.id, s.segment, s.market FROM groups g JOIN startups s ON s.group_id = g.id WHERE g.game_id = ?`).all(game.id);
  const events = db.prepare('SELECT snapshot_json FROM round_events WHERE round_id = ?').all(round.id).map((r) => JSON.parse(r.snapshot_json));

  db.transaction(() => {
    const players = groups.map((g) => {
      let dec = db.prepare('SELECT payload_json FROM decisions WHERE round_id = ? AND group_id = ?').get(round.id, g.id);
      let decision;
      if (dec) decision = JSON.parse(dec.payload_json);
      else {
        decision = defaultDecision(game, g.id, g, params, groups.length);
        db.prepare('INSERT INTO decisions (round_id, group_id, payload_json, auto, updated_at) VALUES (?,?,?,1,?)').run(round.id, g.id, JSON.stringify(decision), Date.now());
      }
      return { groupId: g.id, startup: { segment: g.segment, market: g.market }, prev: prevStateFor(game, g.id, params), decision };
    });
    if (players.length) {
      const { results } = simulateRound(params, players, events);
      const ins = db.prepare(`INSERT INTO kpis (round_id, group_id, revenue, units_sold, lost_sales, inventory, total_costs, profit, cum_profit, cash,
        brand, quality, sustainability, market_share, score, rank, details_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of results) {
        ins.run(round.id, r.groupId, r.revenue, r.units_sold, r.lost_sales, r.inventory, r.total_costs, r.profit, r.cum_profit, r.cash,
          r.brand, r.quality, r.sustainability, r.market_share, r.score, r.rank, JSON.stringify(r.details));
      }
    }
    db.prepare('UPDATE rounds SET status = \'closed\', closed_at = ? WHERE id = ?').run(Date.now(), round.id);
    log(game.id, 'docente', `Round ${round.number} chiuso e calcolato (${players.length} gruppi)`);
  })();
}

// ---------- letture ----------
function leaderboard(gameId) {
  const last = db.prepare('SELECT id, number FROM rounds WHERE game_id = ? AND status = \'closed\' ORDER BY number DESC LIMIT 1').get(gameId);
  if (!last) return { round: 0, rows: [] };
  const rows = db.prepare(`SELECT k.*, g.name AS group_name, s.name AS startup_name, s.segment, s.market, s.category
                           FROM kpis k JOIN groups g ON g.id = k.group_id JOIN startups s ON s.group_id = g.id
                           WHERE k.round_id = ? ORDER BY k.rank`).all(last.id);
  return { round: last.number, rows };
}

function roundEvents(roundId) {
  return db.prepare('SELECT event_id, snapshot_json FROM round_events WHERE round_id = ?').all(roundId)
    .map((r) => ({ id: r.event_id, ...JSON.parse(r.snapshot_json) }));
}

module.exports = {
  GameError, validateDecision, validateStartup, validateParams, validateEvent,
  createGame, updateGame, transition, openRound, closeRound, publicState, getStateRow,
  leaderboard, roundEvents, uniqueCode, formatCode,
};
