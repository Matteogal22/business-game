// Logica di gioco su database: creazione partita, macchina a stati, timer, round, calcolo KPI.
const { db, log } = require('./db');
const { randomCode, formatCode } = require('./auth');
const { DEFAULT_PARAMS, PRESETS, MARKETS, MODULE_KEYS, SOURCING, paramsForSector, applyPreset, clone } = require('./defaults');
const { BUILTIN, GENERAL_EVENTS, MARGIN, OBSOLESCENCE, SENSITIVITY, CHANNEL_TYPES, channelFromType } = require('./sectors');
const { simulateRound } = require('./simulation');

class GameError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

// Parametri di una partita: completa i campi mancanti delle partite create con versioni precedenti
function getParams(game) {
  const p = typeof game === 'string' ? JSON.parse(game) : JSON.parse(game.params_json);
  const d = DEFAULT_PARAMS;
  if (!p.sector) p.sector = clone(d.sector);
  if (!p.categories) p.categories = clone(d.categories);
  if (!p.sectorBase) p.sectorBase = clone(p.segments);
  if (!p.weights) p.weights = clone(d.weights);
  if (!p.modules) p.modules = clone(d.modules);
  for (const k of MODULE_KEYS) if (p.modules[k] === undefined) p.modules[k] = false;
  if (p.judgmentWeight === undefined) p.judgmentWeight = d.judgmentWeight;
  for (const ch of Object.values(p.channels)) if (!ch.desc) ch.desc = '';
  return p;
}

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

function validateDecision(body, params, modules = {}) {
  const d = {
    price: num(body.price, 0.1, 100000, 'Prezzo'),
    production: num(body.production, 0, 10000000, 'Produzione', { int: true }),
    marketing: num(body.marketing, 0, 5000000, 'Marketing', { int: true }),
    design: num(body.design, 0, 5000000, 'Design / R&D', { int: true }),
    sustainability: num(body.sustainability, 0, 5000000, 'Sostenibilità', { int: true }),
    channel: oneOf(body.channel, Object.keys(params.channels), 'Canale'),
    notes: str(body.notes, 500, { label: 'motivazione' }),
  };
  if (modules.sourcing) d.sourcing = oneOf(body.sourcing, Object.keys(SOURCING), 'Luogo di produzione');
  return d;
}

function validateStartup(body, params) {
  return {
    name: str(body.name, 60, { required: true, label: 'nome della startup' }),
    segment: oneOf(body.segment, Object.keys(params.segments), 'Segmento'),
    category: oneOf(body.category, Object.keys(params.categories), 'Categoria'),
    market: oneOf(body.market, MARKETS, 'Mercato'),
    positioning: str(body.positioning, 400, { label: 'posizionamento' }),
    values_text: str(body.values_text, 400, { label: 'valori' }),
  };
}

// Il docente può modificare i parametri: si accettano solo chiavi note e valori numerici in range.
function validateParams(input, base = DEFAULT_PARAMS) {
  const p = clone(base);
  if (!p.modules) p.modules = clone(DEFAULT_PARAMS.modules);
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
  for (const s of Object.keys(p.segments)) {
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
  if (i.scoreWeights) for (const k of Object.keys(p.scoreWeights)) set(p.scoreWeights, k, i.scoreWeights[k], 0, 100, `Peso ${k}`);
  if (Object.values(p.scoreWeights).reduce((a, b) => a + b, 0) <= 0) throw new GameError('Almeno una voce del punteggio deve avere un peso maggiore di zero.');
  set(p, 'judgmentWeight', i.judgmentWeight, 0, 1, 'Peso del giudizio');
  if (p.judgmentWeight === undefined) p.judgmentWeight = DEFAULT_PARAMS.judgmentWeight;
  if (i.preset !== undefined) {
    if (![...Object.keys(PRESETS), 'personalizzato'].includes(i.preset)) throw new GameError('Livello di difficoltà non valido.');
    p.preset = i.preset;
  }
  if (i.modules) for (const k of MODULE_KEYS) if (i.modules[k] !== undefined) p.modules[k] = i.modules[k] === true || i.modules[k] === 'true';
  return p;
}

function validateAnalysis(body) {
  const optNum = (v, min, max, label) => (v === undefined || v === null || v === '' ? null : num(v, min, max, label));
  return {
    market: longText(body.market, 2000, 'testo su mercato ed eventi'),
    competitors: longText(body.competitors, 2000, 'testo sui concorrenti'),
    strategy: longText(body.strategy, 2000, 'testo sulla strategia'),
    risks: longText(body.risks, 2000, 'testo sui rischi'),
    forecast_units: optNum(body.forecast_units, 0, 1e7, 'Previsione pezzi venduti'),
    forecast_profit: optNum(body.forecast_profit, -1e9, 1e9, 'Previsione utile'),
  };
}
// testo lungo: mantiene gli a capo
function longText(v, max, label) {
  const s = String(v ?? '').replace(/\r/g, '').trim();
  if (s.length > max) throw new GameError(`Il ${label} è troppo lungo (max ${max} caratteri).`);
  return s;
}

const CRITERIA = ['market', 'strategy', 'forecast', 'risks'];
function validateEvaluation(body) {
  const vote = num(body.vote, 0, 10, 'Voto');
  if (Math.round(vote * 2) !== vote * 2) throw new GameError('Il voto può avere solo mezzi punti (es. 7,5).');
  const criteria = {};
  for (const k of CRITERIA) {
    const v = body.criteria && body.criteria[k];
    if (v !== undefined && v !== null && v !== '') criteria[k] = num(v, 0, 5, 'Criterio', { int: true });
  }
  return { vote, criteria, comment: longText(body.comment, 1500, 'commento') };
}

function validateEvent(body, params = DEFAULT_PARAMS) {
  const SEGMENTS = Object.keys(params.segments);
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

// ---------- settori personalizzati ----------
const slug = (prefix, i) => `${prefix}${i + 1}`;
function validateSector(body) {
  const b = body || {};
  const name = str(b.name, 40, { required: true, label: 'nome del settore' });
  const productWord = str(b.productWord, 30, { required: true, label: 'nome del prodotto' }).toLowerCase();
  const segIn = Array.isArray(b.segments) ? b.segments : [];
  if (segIn.length < 1 || segIn.length > 5) throw new GameError('Servono da 1 a 5 segmenti.');
  const segments = {};
  segIn.forEach((sg, i) => {
    const label = str(sg.label, 40, { required: true, label: `nome del segmento ${i + 1}` });
    segments[slug('s', i)] = {
      label,
      refPrice: num(sg.refPrice, 0.1, 100000, `${label}: prezzo tipico`),
      unitCost: num(sg.unitCost, 0.01, 100000, `${label}: costo di un pezzo`),
      baseDemand: num(sg.baseDemand, 10, 10000000, `${label}: clienti a round`, { int: true }),
      elasticity: SENSITIVITY[oneOf(sg.sensitivity, Object.keys(SENSITIVITY), `${label}: sensibilità al prezzo`)],
      sensitivity: sg.sensitivity,
    };
    if (segments[slug('s', i)].unitCost >= segments[slug('s', i)].refPrice) throw new GameError(`${label}: il costo di un pezzo deve essere più basso del prezzo tipico.`);
  });
  const catIn = Array.isArray(b.categories) ? b.categories : [];
  if (catIn.length < 1 || catIn.length > 10) throw new GameError('Servono da 1 a 10 categorie.');
  const categories = {};
  catIn.forEach((c, i) => {
    categories[slug('c', i)] = {
      label: str(c.label, 40, { required: true, label: `nome della categoria ${i + 1}` }),
      margin: oneOf(c.margin, Object.keys(MARGIN), 'Margine'),
      obsolescence: oneOf(c.obsolescence, Object.keys(OBSOLESCENCE), 'Rischio invenduto'),
    };
  });
  const chIn = Array.isArray(b.channels) ? b.channels : [];
  if (chIn.length < 1 || chIn.length > 5) throw new GameError('Servono da 1 a 5 canali di vendita.');
  const channels = {};
  chIn.forEach((c, i) => {
    const type = oneOf(c.type, Object.keys(CHANNEL_TYPES), 'Tipo di canale');
    channels[slug('k', i)] = channelFromType(type, segments, str(c.label, 40, { required: true, label: `nome del canale ${i + 1}` }));
  });
  const copyFrom = b.copyFrom && BUILTIN[b.copyFrom] ? b.copyFrom : null;
  // Eventi: quelli generali + quelli del settore copiato che non dipendono dai suoi segmenti
  const events = clone(GENERAL_EVENTS);
  if (copyFrom) for (const e of BUILTIN[copyFrom].events) if (!e.effects.demandBySegment && !events.some((x) => x.title === e.title)) events.push(clone(e));
  return {
    label: name, icon: '✚', productWord, copyFrom, custom: true,
    rules: [`Settore personalizzato con ${Object.keys(segments).length} segmenti e ${Object.keys(categories).length} categorie`],
    weights: copyFrom ? clone(BUILTIN[copyFrom].weights) : { brand: 1.0, quality: 0.7 },
    decay: copyFrom ? clone(BUILTIN[copyFrom].decay) : { brand: 0.05, quality: 0.08, sustainability: 0.05 },
    segments, categories, channels, events,
  };
}
// Settore come lo vede la dashboard (per la scelta e per "copia da")
function sectorSummary(key, s) {
  return {
    key, label: s.label, icon: s.icon || '✚', productWord: s.productWord, rules: s.rules || [], custom: !!s.custom,
    segments: Object.fromEntries(Object.entries(s.segments).map(([k, v]) => [k, { label: v.label, refPrice: v.refPrice, unitCost: v.unitCost, baseDemand: v.baseDemand, elasticity: v.elasticity, sensitivity: v.sensitivity || (v.elasticity < 0.8 ? 'poco' : v.elasticity < 1.3 ? 'abbastanza' : 'molto') }])),
    categories: s.categories,
    channels: Object.fromEntries(Object.entries(s.channels).map(([k, v]) => [k, { label: v.label, type: v.type || (v.priceShare < 0.9 ? 'rivenditori' : v.fixedCost >= 20000 ? 'propri' : 'diretto'), desc: v.desc }])),
    eventsCount: (s.events || []).length,
  };
}
function sectorFor(teacherId, key) {
  if (BUILTIN[key]) return { key, data: BUILTIN[key] };
  const m = /^custom:(\d+)$/.exec(String(key || ''));
  if (m) {
    const row = db.prepare('SELECT * FROM sectors WHERE id = ? AND owner_id = ?').get(Number(m[1]), teacherId);
    if (row) return { key, data: JSON.parse(row.data_json) };
  }
  throw new GameError('Settore non valido.');
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
  const sector = sectorFor(teacherId, body.sector || 'moda');
  let base = paramsForSector(sector.key, sector.data);
  const presetKey = (body.params && body.params.preset) || 'standard';
  if (PRESETS[presetKey]) base = applyPreset(base, presetKey);
  const { segments, startingCash, fixedCostPerRound, outsideOption, ...rest } = body.params || {}; // il preset decide l'economia di partenza
  const params = validateParams(rest, base);

  const tx = db.transaction(() => {
    const { lastInsertRowid: gameId } = db.prepare(`INSERT INTO games (owner_id, name, num_sessions, session_minutes, num_rounds, leaderboard_public, params_json)
      VALUES (?,?,?,?,?,?,?)`).run(teacherId, name, numSessions, sessionMinutes, numRounds, leaderboardPublic, JSON.stringify(params));
    db.prepare('INSERT INTO game_state (game_id, status, updated_at) VALUES (?, \'setup\', ?)').run(gameId, Date.now());
    for (let n = 1; n <= numSessions; n++) db.prepare('INSERT INTO class_sessions (game_id, number, status) VALUES (?,?,\'pending\')').run(gameId, n);
    db.prepare('INSERT INTO access_codes (game_id, code, status) VALUES (?,?,\'active\')').run(gameId, uniqueCode());
    for (const e of sector.data.events || []) {
      db.prepare('INSERT INTO events (game_id, title, description, effects_json, custom) VALUES (?,?,?,?,0)').run(gameId, e.title, e.description, JSON.stringify(e.effects));
    }
    log(gameId, `docente:${teacherId}`, `Partita creata · settore ${sector.data.label}`);
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
  if (body.params !== undefined) fields.params_json = JSON.stringify(validateParams(body.params, getParams(game)));
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
  let roundTimer = null;
  if (openRound && openRound.duration_ms && openRound.session_number === st.current_session && openRound.open_offset_ms !== null) {
    const used = Math.max(0, elapsed - openRound.open_offset_ms);
    roundTimer = { durationMs: openRound.duration_ms, elapsedMs: used, remainingMs: openRound.duration_ms - used };
  }
  return {
    roundTimer,
    roundModules: openRound ? JSON.parse(openRound.modules_json || '{}') : null,
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
function cleanModules(input, fallback) {
  const out = {};
  for (const k of MODULE_KEYS) out[k] = input && input[k] !== undefined ? input[k] === true || input[k] === 'true' : !!(fallback && fallback[k]);
  return out;
}
function openRound(game, eventIds, opts = {}) {
  const st = getStateRow(game.id);
  if (st.status !== 'running') throw new GameError('Avvia (o riprendi) la sessione prima di aprire un round.');
  if (db.prepare('SELECT 1 FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id)) throw new GameError('C\'è già un round aperto.');
  if (st.current_round >= game.num_rounds) throw new GameError('Tutti i round previsti sono stati giocati. Puoi aumentarne il numero nelle impostazioni.');
  const ids = Array.isArray(eventIds) ? eventIds.map(Number).filter(Number.isInteger) : [];
  const minutes = opts.durationMinutes === undefined || opts.durationMinutes === null || opts.durationMinutes === '' || Number(opts.durationMinutes) === 0
    ? null : num(opts.durationMinutes, 1, 300, 'Durata del round', { int: true });
  const params = getParams(game);
  const modules = cleanModules(opts.modules, params.modules);
  const cs = db.prepare('SELECT * FROM class_sessions WHERE game_id = ? AND number = ?').get(game.id, st.current_session);
  db.transaction(() => {
    const n = st.current_round + 1;
    const { lastInsertRowid: roundId } = db.prepare(`INSERT INTO rounds (game_id, number, session_number, status, opened_at, duration_ms, open_offset_ms, modules_json)
      VALUES (?,?,?,'open',?,?,?,?)`).run(game.id, n, st.current_session, Date.now(), minutes ? minutes * 60000 : null, cs ? sessionElapsed(cs) : 0, JSON.stringify(modules));
    // i moduli scelti diventano la nuova impostazione della partita
    params.modules = modules;
    db.prepare('UPDATE games SET params_json = ? WHERE id = ?').run(JSON.stringify(params), game.id);
    for (const id of ids) {
      const ev = db.prepare('SELECT * FROM events WHERE id = ? AND game_id = ?').get(id, game.id); // solo eventi di QUESTA partita
      if (!ev) throw new GameError('Evento non valido.');
      db.prepare('INSERT INTO round_events (round_id, event_id, snapshot_json) VALUES (?,?,?)')
        .run(roundId, id, JSON.stringify({ title: ev.title, description: ev.description, effects: JSON.parse(ev.effects_json) }));
    }
    setState(game.id, { current_round: n });
    log(game.id, 'docente', `Round ${n} aperto${minutes ? ` (${minutes} minuti)` : ''}`);
  })();
}

// Allunga (o accorcia) il timer del round aperto
function extendRound(game, minutes) {
  const round = db.prepare('SELECT * FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id);
  if (!round) throw new GameError('Nessun round aperto.');
  const m = num(minutes, -60, 120, 'Minuti', { int: true });
  if (!round.duration_ms) {
    const st = getStateRow(game.id);
    const cs = db.prepare('SELECT * FROM class_sessions WHERE game_id = ? AND number = ?').get(game.id, st.current_session);
    const offset = cs ? sessionElapsed(cs) : 0;
    db.prepare('UPDATE rounds SET duration_ms = ?, open_offset_ms = ?, session_number = ? WHERE id = ?').run(Math.max(60000, m * 60000), offset, st.current_session, round.id);
  } else {
    db.prepare('UPDATE rounds SET duration_ms = ? WHERE id = ?').run(Math.max(60000, round.duration_ms + m * 60000), round.id);
  }
  log(game.id, 'docente', `Timer del round: ${m > 0 ? '+' : ''}${m} minuti`);
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
    marketing: 20000, design: 15000, sustainability: 10000, channel: Object.keys(params.channels)[0], sourcing: 'europa', notes: '(decisione automatica)',
  };
}

function closeRound(game) {
  const round = db.prepare('SELECT * FROM rounds WHERE game_id = ? AND status = \'open\'').get(game.id);
  if (!round) throw new GameError('Nessun round aperto.');
  const params = getParams(game);
  const modules = JSON.parse(round.modules_json || '{}');
  const groups = db.prepare(`SELECT g.id, s.segment, s.market, s.category FROM groups g JOIN startups s ON s.group_id = g.id WHERE g.game_id = ?`).all(game.id);
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
      if (modules.sourcing && !decision.sourcing) decision.sourcing = 'europa';
      return { groupId: g.id, startup: { segment: g.segment, market: g.market, category: g.category }, prev: prevStateFor(game, g.id, params), decision };
    });
    if (players.length) {
      const { results } = simulateRound(params, players, events, modules);
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

// Classifica finale: punteggio di gioco + giudizio del docente, pesati come deciso nelle impostazioni
function finalRanking(game) {
  const params = getParams(game);
  const w = params.judgmentWeight ?? DEFAULT_PARAMS.judgmentWeight;
  const lb = leaderboard(game.id);
  const evals = new Map(db.prepare('SELECT * FROM evaluations WHERE game_id = ?').all(game.id).map((e) => [e.group_id, e]));
  const rows = lb.rows.map((r) => {
    const ev = evals.get(r.group_id);
    const vote = ev ? ev.vote : null;
    const finalScore = vote === null ? null : Math.round((r.score * (1 - w) + vote * 10 * w) * 100) / 100;
    return { groupId: r.group_id, groupName: r.group_name, startupName: r.startup_name, segment: r.segment, market: r.market,
      gameScore: r.score, gameRank: r.rank, vote, finalScore, effective: finalScore ?? r.score };
  });
  rows.sort((a, b) => b.effective - a.effective || b.gameScore - a.gameScore);
  rows.forEach((r, i) => { r.finalRank = i + 1; r.movement = r.gameRank - r.finalRank; });
  return { round: lb.round, weight: w, allEvaluated: rows.length > 0 && rows.every((r) => r.vote !== null), rows };
}

// Report di mercato di un round: i dati "pubblici" che un manager troverebbe in un'analisi di settore
function marketReport(game, roundId) {
  const params = getParams(game);
  const rows = db.prepare(`SELECT k.units_sold, k.market_share, k.details_json, s.name AS startup_name, s.segment, s.market, d.payload_json
    FROM kpis k JOIN startups s ON s.group_id = k.group_id LEFT JOIN decisions d ON d.round_id = k.round_id AND d.group_id = k.group_id
    WHERE k.round_id = ?`).all(roundId);
  const pools = {};
  for (const r of rows) {
    const key = r.segment + '|' + r.market;
    const det = JSON.parse(r.details_json);
    const dec = r.payload_json ? JSON.parse(r.payload_json) : {};
    const p = (pools[key] = pools[key] || { segment: r.segment, segmentLabel: (params.segments[r.segment] || {}).label || r.segment, market: r.market, demand: det.poolDemand, sold: 0, revenueAtPrice: 0, players: [] });
    p.sold += r.units_sold; p.revenueAtPrice += r.units_sold * (dec.price || 0);
    p.players.push({ startupName: r.startup_name, share: r.market_share, price: dec.price || null, channel: dec.channel ? (params.channels[dec.channel] || {}).label : null });
  }
  return Object.values(pools).map((p) => ({
    segment: p.segment, segmentLabel: p.segmentLabel, market: p.market, demand: Math.round(p.demand), sold: Math.round(p.sold),
    unserved: Math.max(0, Math.round(p.demand - p.sold)), avgPrice: p.sold ? Math.round((p.revenueAtPrice / p.sold) * 100) / 100 : null,
    players: p.players.sort((a, b) => b.share - a.share),
  })).sort((a, b) => b.demand - a.demand);
}

// Premi speciali (modulo): calcolati su tutto il percorso dei gruppi
function awards(game) {
  const lb = leaderboard(game.id);
  if (!lb.rows.length) return [];
  const all = db.prepare(`SELECT k.group_id, k.score, k.profit, r.number, a.forecast_profit, a.forecast_units, k.units_sold
    FROM kpis k JOIN rounds r ON r.id = k.round_id LEFT JOIN analyses a ON a.round_id = k.round_id AND a.group_id = k.group_id
    WHERE r.game_id = ? ORDER BY r.number`).all(game.id);
  const name = (gid) => { const r = lb.rows.find((x) => x.group_id === gid); return r ? { groupId: gid, startupName: r.startup_name, groupName: r.group_name } : null; };
  const best = (fn) => [...lb.rows].sort((a, b) => fn(b) - fn(a))[0];
  const out = [];
  const sus = best((r) => r.sustainability);
  out.push({ key: 'sostenibile', label: 'Strategia più sostenibile', desc: 'Indice di sostenibilità più alto a fine gioco', winner: name(sus.group_id), value: `${Math.round(sus.sustainability)}/100` });
  const br = best((r) => r.brand);
  out.push({ key: 'brand', label: 'Brand più forte', desc: 'Forza del brand più alta a fine gioco', winner: name(br.group_id), value: `${Math.round(br.brand)}/100` });
  const pr = best((r) => r.cum_profit);
  out.push({ key: 'redditizia', label: 'Startup più redditizia', desc: 'Utile cumulato più alto', winner: name(pr.group_id), value: `${Math.round(pr.cum_profit).toLocaleString('it-IT')} €` });
  // crescita: miglioramento del punteggio dal primo all'ultimo round giocato
  const byG = {};
  for (const r of all) (byG[r.group_id] = byG[r.group_id] || []).push(r);
  const growth = Object.entries(byG).filter(([, l]) => l.length >= 2).map(([g, l]) => ({ g: Number(g), d: l[l.length - 1].score - l[0].score }));
  if (growth.length) { const g = growth.sort((a, b) => b.d - a.d)[0]; out.push({ key: 'crescita', label: 'Miglior rimonta', desc: 'Punteggio cresciuto di più dal primo all\'ultimo round', winner: name(g.g), value: `${g.d >= 0 ? '+' : ''}${g.d.toFixed(1)} punti` }); }
  // previsioni: errore medio più basso tra utile previsto e reale
  const acc = Object.entries(byG).map(([g, l]) => {
    const f = l.filter((r) => r.forecast_profit !== null && r.forecast_profit !== undefined);
    if (!f.length) return null;
    const err = f.reduce((s, r) => s + Math.abs(r.profit - r.forecast_profit) / Math.max(1, Math.abs(r.profit)), 0) / f.length;
    return { g: Number(g), err, n: f.length };
  }).filter(Boolean);
  if (acc.length) { const a = acc.sort((x, y) => x.err - y.err)[0]; out.push({ key: 'previsioni', label: 'Previsioni più accurate', desc: 'Utile previsto più vicino a quello reale', winner: name(a.g), value: `errore medio ${Math.round(a.err * 100)}%` }); }
  return out;
}

function roundEvents(roundId) {
  return db.prepare('SELECT event_id, snapshot_json FROM round_events WHERE round_id = ?').all(roundId)
    .map((r) => ({ id: r.event_id, ...JSON.parse(r.snapshot_json) }));
}

module.exports = {
  GameError, validateDecision, validateStartup, validateParams, validateEvent, validateAnalysis, validateEvaluation, finalRanking, CRITERIA,
  validateSector, sectorSummary, getParams, marketReport, awards, extendRound, cleanModules,
  createGame, updateGame, transition, openRound, closeRound, publicState, getStateRow,
  leaderboard, roundEvents, uniqueCode, formatCode,
};
