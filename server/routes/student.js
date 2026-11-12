// API area studenti. Nessun account richiesto: si entra con il codice della sessione.
// Dopo l'ingresso il gruppo è identificato SOLO dal token in cookie, che è legato a una sola partita:
// nessuna rotta accetta un id di partita o di gruppo dal browser.
const express = require('express');
const { db, log } = require('../db');
const auth = require('../auth');
const game = require('../game');
const { DEFAULT_PARAMS } = require('../defaults');

const router = express.Router();
const codeLimiter = auth.rateLimit({ windowMs: 10 * 60 * 1000, max: 30, key: (req) => 'code:' + req.ip });

function findCode(raw) {
  const code = auth.normalizeCode(raw);
  if (code.length !== 8) return null;
  return db.prepare(`SELECT c.code, c.status AS code_status, c.game_id, g.name AS game_name, s.status AS game_status
    FROM access_codes c JOIN games g ON g.id = c.game_id JOIN game_state s ON s.game_id = g.id
    WHERE c.code = ? AND c.id = (SELECT MAX(id) FROM access_codes WHERE game_id = c.game_id)`).get(code) || null; // solo il codice corrente
}
const STATUS_LABEL = { setup: 'In preparazione', running: 'In corso', paused: 'In pausa', session_closed: 'Sessione chiusa', debrief: 'Debriefing', ended: 'Terminata' };

router.post('/check-code', codeLimiter, (req, res) => {
  const c = findCode((req.body || {}).code);
  if (!c) return res.status(404).json({ error: 'Codice non valido.' });
  if (c.code_status === 'suspended') return res.status(403).json({ error: 'Questo codice è stato sospeso dal docente.' });
  res.json({ gameName: c.game_name, gameStatus: c.game_status, gameStatusLabel: STATUS_LABEL[c.game_status], codeStatus: c.code_status });
});

router.post('/join', codeLimiter, (req, res) => {
  const body = req.body || {};
  const c = findCode(body.code);
  if (!c) return res.status(404).json({ error: 'Codice non valido.' });
  if (c.code_status === 'suspended') return res.status(403).json({ error: 'Questo codice è stato sospeso dal docente.' });

  const groupName = String(body.groupName || '').trim().replace(/\s+/g, ' ');
  if (!groupName || groupName.length > 40) return res.status(400).json({ error: 'Inserisci un nome gruppo (max 40 caratteri).' });
  const existing = db.prepare('SELECT * FROM groups WHERE game_id = ? AND name = ?').get(c.game_id, groupName);

  if (existing) {
    // Rientro di un gruppo già registrato (es. nuova sessione, altro computer): serve il PIN
    if (!body.pin || auth.hashPin(body.pin) !== existing.recovery_hash) {
      return res.status(403).json({ error: 'Questo nome gruppo esiste già. Per rientrare inserisci il PIN di rientro del gruppo.', needPin: true });
    }
    auth.createGroupToken(res, existing.id);
    log(c.game_id, `gruppo:${existing.id}`, 'Rientro nel gioco');
    return res.json({ ok: true, rejoined: true });
  }

  if (c.code_status !== 'active') return res.status(403).json({ error: 'Il codice è scaduto: non è possibile registrare nuovi gruppi.' });
  if (['debrief', 'ended'].includes(c.game_status)) return res.status(403).json({ error: 'La partita è conclusa: non è possibile registrare nuovi gruppi.' });

  const members = (Array.isArray(body.members) ? body.members : String(body.members || '').split(/[,\n]/))
    .map((m) => String(m).trim()).filter(Boolean).slice(0, 12).map((m) => m.slice(0, 60));
  const pin = auth.randomCode(6);
  const groupId = db.transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO groups (game_id, name, recovery_hash) VALUES (?,?,?)').run(c.game_id, groupName, auth.hashPin(pin));
    for (const m of members) db.prepare('INSERT INTO group_members (group_id, name) VALUES (?,?)').run(lastInsertRowid, m);
    log(c.game_id, `gruppo:${lastInsertRowid}`, `Nuovo gruppo registrato: ${groupName}`);
    return Number(lastInsertRowid);
  })();
  auth.createGroupToken(res, groupId);
  res.status(201).json({ ok: true, pin });
});

router.post('/leave', (req, res) => { auth.clearGroupToken(req, res); res.json({ ok: true }); });

// ----- da qui serve un gruppo valido -----
router.use(auth.requireGroup);

router.get('/state', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(req.group.game_id);
  const params = JSON.parse(g.params_json);
  const state = game.publicState(g);
  const members = db.prepare('SELECT name FROM group_members WHERE group_id = ?').all(req.group.id).map((m) => m.name);
  const startup = db.prepare('SELECT name, segment, category, market, positioning, values_text FROM startups WHERE group_id = ?').get(req.group.id) || null;
  const rounds = db.prepare('SELECT id, number, session_number, status FROM rounds WHERE game_id = ? ORDER BY number').all(g.id);
  const openRound = rounds.find((r) => r.status === 'open');
  const myDecision = openRound ? db.prepare('SELECT payload_json, updated_at FROM decisions WHERE round_id = ? AND group_id = ?').get(openRound.id, req.group.id) : null;

  // Solo i PROPRI KPI e le PROPRIE decisioni
  const history = db.prepare(`SELECT r.number AS round, k.revenue, k.units_sold, k.lost_sales, k.inventory, k.total_costs, k.profit, k.cum_profit, k.cash,
      k.brand, k.quality, k.sustainability, k.market_share, k.score, k.rank, k.details_json, d.payload_json, d.auto
    FROM kpis k JOIN rounds r ON r.id = k.round_id LEFT JOIN decisions d ON d.round_id = k.round_id AND d.group_id = k.group_id
    WHERE k.group_id = ? AND r.game_id = ? ORDER BY r.number`).all(req.group.id, g.id)
    .map((h) => ({ ...h, details: JSON.parse(h.details_json), decision: h.payload_json ? JSON.parse(h.payload_json) : null, details_json: undefined, payload_json: undefined }));

  // Elementi pubblici della competizione: identità delle startup concorrenti ed eventi annunciati
  const competitors = db.prepare(`SELECT s.name, s.segment, s.category, s.market, s.positioning FROM startups s
    WHERE s.game_id = ? AND s.group_id != ? ORDER BY s.name`).all(g.id, req.group.id);
  const events = rounds.map((r) => ({ round: r.number, events: game.roundEvents(r.id).map(({ title, description }) => ({ title, description })) }))
    .filter((r) => r.events.length);

  const showBoard = g.leaderboard_public || ['debrief', 'ended'].includes(state.status);
  let board = null;
  if (showBoard) {
    const lb = game.leaderboard(g.id);
    board = { round: lb.round, rows: lb.rows.map((r) => ({ rank: r.rank, groupName: r.group_name, startupName: r.startup_name, segment: r.segment, market: r.market, score: r.score, isMe: r.group_id === req.group.id })) };
  }

  res.json({
    gameName: g.name,
    state, statusLabel: STATUS_LABEL[state.status], codeStatus: req.codeStatus,
    group: { name: req.group.name, members },
    startup, startupLocked: history.length > 0,
    openRound: openRound ? { number: openRound.number, decision: myDecision ? JSON.parse(myDecision.payload_json) : null, savedAt: myDecision ? myDecision.updated_at : null } : null,
    history, competitors, events, leaderboard: board,
    market: { // informazioni di mercato pubbliche per decidere
      segments: Object.fromEntries(Object.entries(params.segments).map(([k, s]) => [k, { label: s.label, refPrice: s.refPrice, unitCost: s.unitCost }])),
      markets: Object.fromEntries(Object.entries(params.markets).map(([k, m]) => [k, { label: m.label }])),
      channels: Object.fromEntries(Object.entries(params.channels || DEFAULT_PARAMS.channels).map(([k, c]) => [k, { label: c.label, fixedCost: c.fixedCost, priceShare: c.priceShare }])),
      fixedCostPerRound: params.fixedCostPerRound, startingCash: params.startingCash,
    },
  });
});

router.put('/startup', (req, res) => {
  const st = game.getStateRow(req.group.game_id);
  if (['debrief', 'ended'].includes(st.status)) throw new game.GameError('La partita è conclusa.');
  if (req.codeStatus !== 'active') throw new game.GameError('Il codice non è attivo.', 403);
  const s = game.validateStartup(req.body || {});
  const existing = db.prepare('SELECT * FROM startups WHERE group_id = ?').get(req.group.id);
  const locked = !!db.prepare('SELECT 1 FROM kpis WHERE group_id = ?').get(req.group.id);
  if (existing && locked && (existing.segment !== s.segment || existing.market !== s.market)) {
    throw new game.GameError('Segmento e mercato non si possono cambiare dopo il primo round calcolato.');
  }
  const clash = db.prepare('SELECT 1 FROM startups WHERE game_id = ? AND name = ? AND group_id != ?').get(req.group.game_id, s.name, req.group.id);
  if (clash) throw new game.GameError('Esiste già una startup con questo nome in questa sessione.');
  db.prepare(`INSERT INTO startups (group_id, game_id, name, segment, category, market, positioning, values_text) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(group_id) DO UPDATE SET name=excluded.name, segment=excluded.segment, category=excluded.category, market=excluded.market,
    positioning=excluded.positioning, values_text=excluded.values_text`)
    .run(req.group.id, req.group.game_id, s.name, s.segment, s.category, s.market, s.positioning, s.values_text);
  log(req.group.game_id, `gruppo:${req.group.id}`, existing ? 'Startup aggiornata' : `Startup creata: ${s.name}`);
  res.json({ ok: true });
});

router.put('/decision', (req, res) => {
  const st = game.getStateRow(req.group.game_id);
  if (req.codeStatus !== 'active') throw new game.GameError('Il codice non è attivo.', 403);
  if (st.status !== 'running') throw new game.GameError('Le decisioni si possono inviare solo mentre la sessione è in corso.');
  const round = db.prepare('SELECT id FROM rounds WHERE game_id = ? AND status = \'open\'').get(req.group.game_id);
  if (!round) throw new game.GameError('Nessun round aperto in questo momento.');
  if (!db.prepare('SELECT 1 FROM startups WHERE group_id = ?').get(req.group.id)) throw new game.GameError('Configura prima la tua startup.');
  const d = game.validateDecision(req.body || {});
  db.prepare(`INSERT INTO decisions (round_id, group_id, payload_json, auto, updated_at) VALUES (?,?,?,0,?)
    ON CONFLICT(round_id, group_id) DO UPDATE SET payload_json = excluded.payload_json, auto = 0, updated_at = excluded.updated_at`)
    .run(round.id, req.group.id, JSON.stringify(d), Date.now());
  res.json({ ok: true });
});

module.exports = router;
