// API area docente. TUTTE le rotte (tranne login) passano da requireTeacher,
// e quelle su una partita da requireOwnGame (il docente vede solo le proprie partite).
const express = require('express');
const { db, log } = require('../db');
const auth = require('../auth');
const game = require('../game');

const router = express.Router();
const loginLimiter = auth.rateLimit({ windowMs: 10 * 60 * 1000, max: 10, key: (req) => 'login:' + req.ip });

router.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Messaggio identico per utente inesistente / non autorizzato / password errata
  if (!user || !user.active || user.role !== 'teacher' || !auth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenziali non valide o account non autorizzato.' });
  }
  auth.createTeacherSession(res, user.id);
  res.json({ ok: true, name: user.name });
});

router.use(auth.requireTeacher);

router.get('/me', (req, res) => res.json(req.teacher));
router.post('/logout', (req, res) => { auth.destroyTeacherSession(req, res); res.json({ ok: true }); });

router.get('/games', (req, res) => {
  const rows = db.prepare(`SELECT g.id, g.name, g.created_at, s.status, s.current_session, s.current_round, g.num_sessions, g.num_rounds,
      (SELECT COUNT(*) FROM groups WHERE game_id = g.id) AS groups_count,
      (SELECT code FROM access_codes WHERE game_id = g.id ORDER BY id DESC LIMIT 1) AS code,
      (SELECT status FROM access_codes WHERE game_id = g.id ORDER BY id DESC LIMIT 1) AS code_status
    FROM games g JOIN game_state s ON s.game_id = g.id WHERE g.owner_id = ? ORDER BY g.id DESC`).all(req.teacher.id);
  res.json(rows.map((r) => ({ ...r, code: auth.formatCode(r.code) })));
});

router.post('/games', (req, res) => {
  const id = game.createGame(req.teacher.id, req.body || {});
  res.status(201).json({ id });
});

// ----- da qui: operazioni su una partita del docente -----
const own = express.Router({ mergeParams: true });
router.use('/games/:gameId', auth.requireOwnGame, own);

own.get('/', (req, res) => {
  const g = req.game;
  const code = db.prepare('SELECT code, status FROM access_codes WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(g.id);
  const groups = db.prepare(`SELECT g.id, g.name, g.created_at, s.name AS startup_name, s.segment, s.category, s.market, s.positioning, s.values_text,
      (SELECT COUNT(*) FROM group_tokens t WHERE t.group_id = g.id) AS devices
    FROM groups g LEFT JOIN startups s ON s.group_id = g.id WHERE g.game_id = ? ORDER BY g.id`).all(g.id);
  const members = db.prepare('SELECT m.group_id, m.name FROM group_members m JOIN groups g ON g.id = m.group_id WHERE g.game_id = ?').all(g.id);
  for (const gr of groups) gr.members = members.filter((m) => m.group_id === gr.id).map((m) => m.name);

  const rounds = db.prepare('SELECT * FROM rounds WHERE game_id = ? ORDER BY number').all(g.id)
    .map((r) => ({ ...r, events: game.roundEvents(r.id) }));
  const openRound = rounds.find((r) => r.status === 'open');
  let currentDecisions = [];
  if (openRound) {
    currentDecisions = db.prepare('SELECT group_id, payload_json, updated_at FROM decisions WHERE round_id = ?').all(openRound.id)
      .map((d) => ({ groupId: d.group_id, decision: JSON.parse(d.payload_json), updatedAt: d.updated_at }));
  }
  const sessions = db.prepare('SELECT number, status, started_at, closed_at, elapsed_ms, running_since FROM class_sessions WHERE game_id = ? ORDER BY number').all(g.id)
    .map((s) => ({ ...s, elapsed_ms: s.elapsed_ms + (s.status === 'running' && s.running_since ? Date.now() - s.running_since : 0) }));
  const events = db.prepare('SELECT id, title, description, effects_json, custom FROM events WHERE game_id = ? ORDER BY id').all(g.id)
    .map((e) => ({ id: e.id, title: e.title, description: e.description, effects: JSON.parse(e.effects_json), custom: !!e.custom }));
  const logRows = db.prepare('SELECT actor, action, at FROM audit_log WHERE game_id = ? ORDER BY id DESC LIMIT 40').all(g.id);

  res.json({
    game: { id: g.id, name: g.name, numSessions: g.num_sessions, sessionMinutes: g.session_minutes, numRounds: g.num_rounds,
      leaderboardPublic: !!g.leaderboard_public, params: JSON.parse(g.params_json) },
    state: game.publicState(g),
    code: { code: auth.formatCode(code.code), status: code.status },
    sessions, groups, rounds, currentDecisions, events,
    leaderboard: game.leaderboard(g.id),
    log: logRows,
  });
});

own.patch('/', (req, res) => { game.updateGame(req.game, req.body || {}); res.json({ ok: true }); });

own.post('/state/:action', (req, res) => {
  game.transition(req.game, req.params.action);
  res.json({ ok: true, state: game.publicState(req.game) });
});

own.post('/rounds/open', (req, res) => { game.openRound(req.game, (req.body || {}).eventIds); res.json({ ok: true }); });
own.post('/rounds/close', (req, res) => { game.closeRound(req.game); res.json({ ok: true }); });

// Codice di accesso: attiva / sospendi / scaduto, oppure rigenera (il vecchio codice scade)
own.post('/code/status', (req, res) => {
  const status = String((req.body || {}).status);
  if (!['active', 'suspended', 'expired'].includes(status)) throw new game.GameError('Stato codice non valido.');
  const st = game.getStateRow(req.game.id);
  if (status === 'active' && st.status === 'ended') throw new game.GameError('La partita è terminata: il codice non può essere riattivato.');
  const code = db.prepare('SELECT id FROM access_codes WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(req.game.id);
  db.prepare('UPDATE access_codes SET status = ? WHERE id = ?').run(status, code.id);
  log(req.game.id, 'docente', `Codice impostato su: ${status}`);
  res.json({ ok: true });
});
own.post('/code/regenerate', (req, res) => {
  const st = game.getStateRow(req.game.id);
  if (st.status === 'ended') throw new game.GameError('La partita è terminata.');
  db.transaction(() => {
    db.prepare('UPDATE access_codes SET status = \'expired\' WHERE game_id = ?').run(req.game.id);
    db.prepare('INSERT INTO access_codes (game_id, code, status) VALUES (?,?,\'active\')').run(req.game.id, game.uniqueCode());
    log(req.game.id, 'docente', 'Nuovo codice generato (i gruppi già registrati restano collegati)');
  })();
  res.json({ ok: true });
});

// Gruppi
own.post('/groups/:groupId/recovery', (req, res) => {
  const gr = db.prepare('SELECT id FROM groups WHERE id = ? AND game_id = ?').get(Number(req.params.groupId), req.game.id);
  if (!gr) throw new game.GameError('Gruppo non trovato.', 404);
  const pin = auth.randomCode(6);
  db.prepare('UPDATE groups SET recovery_hash = ? WHERE id = ?').run(auth.hashPin(pin), gr.id);
  log(req.game.id, 'docente', `PIN di rientro rigenerato per gruppo #${gr.id}`);
  res.json({ pin });
});
own.post('/groups/:groupId/logout-devices', (req, res) => {
  const gr = db.prepare('SELECT id FROM groups WHERE id = ? AND game_id = ?').get(Number(req.params.groupId), req.game.id);
  if (!gr) throw new game.GameError('Gruppo non trovato.', 404);
  db.prepare('DELETE FROM group_tokens WHERE group_id = ?').run(gr.id);
  log(req.game.id, 'docente', `Dispositivi scollegati per gruppo #${gr.id}`);
  res.json({ ok: true });
});
own.delete('/groups/:groupId', (req, res) => {
  const gr = db.prepare('SELECT id FROM groups WHERE id = ? AND game_id = ?').get(Number(req.params.groupId), req.game.id);
  if (!gr) throw new game.GameError('Gruppo non trovato.', 404);
  if (db.prepare('SELECT 1 FROM kpis WHERE group_id = ?').get(gr.id)) throw new game.GameError('Il gruppo ha già risultati calcolati: non può essere eliminato.');
  db.prepare('DELETE FROM groups WHERE id = ?').run(gr.id);
  log(req.game.id, 'docente', `Gruppo #${gr.id} eliminato`);
  res.json({ ok: true });
});

// Catalogo eventi (personalizzabile)
own.post('/events', (req, res) => {
  const e = game.validateEvent(req.body || {});
  const { lastInsertRowid } = db.prepare('INSERT INTO events (game_id, title, description, effects_json, custom) VALUES (?,?,?,?,1)')
    .run(req.game.id, e.title, e.description, JSON.stringify(e.effects));
  log(req.game.id, 'docente', `Evento aggiunto: ${e.title}`);
  res.status(201).json({ id: Number(lastInsertRowid) });
});
own.put('/events/:eventId', (req, res) => {
  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND game_id = ?').get(Number(req.params.eventId), req.game.id);
  if (!ev) throw new game.GameError('Evento non trovato.', 404);
  const e = game.validateEvent(req.body || {});
  db.prepare('UPDATE events SET title = ?, description = ?, effects_json = ? WHERE id = ?').run(e.title, e.description, JSON.stringify(e.effects), ev.id);
  res.json({ ok: true });
});
own.delete('/events/:eventId', (req, res) => {
  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND game_id = ?').get(Number(req.params.eventId), req.game.id);
  if (!ev) throw new game.GameError('Evento non trovato.', 404);
  if (db.prepare('SELECT 1 FROM round_events WHERE event_id = ?').get(ev.id)) throw new game.GameError('Evento già usato in un round: non può essere eliminato.');
  db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  res.json({ ok: true });
});

// Risultati aggregati e storico completo (per debriefing)
own.get('/results', (req, res) => {
  const rows = db.prepare(`SELECT r.number AS round, k.*, g.name AS group_name, s.name AS startup_name, s.segment, s.market, d.payload_json, d.auto
    FROM kpis k JOIN rounds r ON r.id = k.round_id JOIN groups g ON g.id = k.group_id JOIN startups s ON s.group_id = g.id
    LEFT JOIN decisions d ON d.round_id = k.round_id AND d.group_id = k.group_id
    WHERE r.game_id = ? ORDER BY r.number, k.rank`).all(req.game.id)
    .map((r) => ({ ...r, decision: r.payload_json ? JSON.parse(r.payload_json) : null, details: JSON.parse(r.details_json), payload_json: undefined, details_json: undefined }));
  const byRound = {};
  for (const r of rows) {
    const a = (byRound[r.round] = byRound[r.round] || { round: r.round, n: 0, revenue: 0, profit: 0, price: 0, marketing: 0, sustainability: 0, brand: 0 });
    a.n++; a.revenue += r.revenue; a.profit += r.profit; a.brand += r.brand; a.sustainability += r.sustainability;
    if (r.decision) { a.price += r.decision.price; a.marketing += r.decision.marketing; }
  }
  const aggregates = Object.values(byRound).map((a) => ({
    round: a.round, groups: a.n, totalRevenue: a.revenue, avgProfit: a.profit / a.n, avgPrice: a.price / a.n,
    avgMarketing: a.marketing / a.n, avgBrand: a.brand / a.n, avgSustainability: a.sustainability / a.n,
  }));
  res.json({ rows, aggregates });
});

own.get('/export.csv', (req, res) => {
  const rows = db.prepare(`SELECT r.number, g.name AS gruppo, s.name AS startup, s.segment, s.market, d.payload_json, k.revenue, k.units_sold, k.profit,
      k.cum_profit, k.cash, k.brand, k.quality, k.sustainability, k.market_share, k.score, k.rank
    FROM kpis k JOIN rounds r ON r.id = k.round_id JOIN groups g ON g.id = k.group_id JOIN startups s ON s.group_id = g.id
    LEFT JOIN decisions d ON d.round_id = k.round_id AND d.group_id = k.group_id WHERE r.game_id = ? ORDER BY r.number, k.rank`).all(req.game.id);
  const esc = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['round', 'gruppo', 'startup', 'segmento', 'mercato', 'prezzo', 'produzione', 'marketing', 'design', 'sostenibilita_inv', 'canale', 'motivazione',
    'ricavi', 'unita_vendute', 'utile', 'utile_cumulato', 'cassa', 'brand', 'qualita', 'sostenibilita', 'quota_mercato', 'punteggio', 'posizione'];
  const lines = [head.join(';')];
  for (const r of rows) {
    const d = r.payload_json ? JSON.parse(r.payload_json) : {};
    lines.push([r.number, r.gruppo, r.startup, r.segment, r.market, d.price, d.production, d.marketing, d.design, d.sustainability, d.channel, d.notes,
      r.revenue, r.units_sold, r.profit, r.cum_profit, r.cash, r.brand, r.quality, r.sustainability, r.market_share, r.score, r.rank].map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="business-game-${req.game.id}.csv"`);
  res.send('﻿' + lines.join('\n'));
});

module.exports = router;
