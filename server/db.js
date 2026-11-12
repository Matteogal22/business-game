// Connessione SQLite e schema dati.
// Ogni area richiesta dal brief ha la sua tabella: utenti/autorizzazioni, sessioni del game,
// codici di accesso, gruppi, startup, round, decisioni, eventi geopolitici, KPI/punteggi, stato partita.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'business-game.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
-- 1. UTENTI E AUTORIZZAZIONI ------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('teacher')),
  active        INTEGER NOT NULL DEFAULT 1,  -- 0 = rimosso dalla allowlist
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auth_sessions (          -- sessioni di login docente
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 2. SESSIONI DEL GAME (la partita) e SESSIONI D'AULA (le 3 da 90 minuti) ----
CREATE TABLE IF NOT EXISTS games (
  id                 INTEGER PRIMARY KEY,
  owner_id           INTEGER NOT NULL REFERENCES users(id),
  name               TEXT NOT NULL,
  num_sessions       INTEGER NOT NULL DEFAULT 3,
  session_minutes    INTEGER NOT NULL DEFAULT 90,
  num_rounds         INTEGER NOT NULL DEFAULT 6,
  leaderboard_public INTEGER NOT NULL DEFAULT 1,
  params_json        TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS class_sessions (
  id            INTEGER PRIMARY KEY,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','paused','closed')),
  started_at    INTEGER,
  closed_at     INTEGER,
  elapsed_ms    INTEGER NOT NULL DEFAULT 0,   -- tempo accumulato
  running_since INTEGER,                      -- timestamp dell'ultimo avvio/ripresa
  UNIQUE (game_id, number)
);

-- 3. STATO DELLA PARTITA ------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_state (
  game_id         INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('setup','running','paused','session_closed','debrief','ended')),
  current_session INTEGER NOT NULL DEFAULT 0,
  current_round   INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

-- 4. CODICI DI ACCESSO --------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_codes (
  id         INTEGER PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL CHECK (status IN ('active','suspended','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. GRUPPI -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id            INTEGER PRIMARY KEY,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name          TEXT NOT NULL COLLATE NOCASE,
  recovery_hash TEXT NOT NULL,             -- PIN di rientro (hash)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, name)
);
CREATE TABLE IF NOT EXISTS group_members (
  id       INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_tokens (          -- dispositivi collegati al gruppo
  token_hash TEXT PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- 6. STARTUP ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startups (
  group_id    INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE,
  segment     TEXT NOT NULL,     -- premium | luxury
  category    TEXT NOT NULL,     -- abbigliamento | accessori | calzature | gioielli
  market      TEXT NOT NULL,     -- EU | US | ASIA
  positioning TEXT NOT NULL DEFAULT '',
  values_text TEXT NOT NULL DEFAULT '',
  UNIQUE (game_id, name)
);

-- 7. ROUND --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rounds (
  id             INTEGER PRIMARY KEY,
  game_id        INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  session_number INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('open','closed')),
  opened_at      INTEGER NOT NULL,
  closed_at      INTEGER,
  UNIQUE (game_id, number)
);

-- 8. DECISIONI ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decisions (
  id           INTEGER PRIMARY KEY,
  round_id     INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  auto         INTEGER NOT NULL DEFAULT 0,  -- 1 = decisione automatica (gruppo che non ha inviato)
  updated_at   INTEGER NOT NULL,
  UNIQUE (round_id, group_id)
);

-- 9. EVENTI GEOPOLITICI -------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (              -- catalogo eventi della partita (modificabile)
  id           INTEGER PRIMARY KEY,
  game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  effects_json TEXT NOT NULL,
  custom       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS round_events (        -- eventi attivati in un round (pubblici)
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL,                   -- copia dell'evento al momento dell'attivazione
  PRIMARY KEY (round_id, event_id)
);

-- 10. KPI E PUNTEGGI ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpis (
  round_id       INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  revenue        REAL NOT NULL,
  units_sold     REAL NOT NULL,
  lost_sales     REAL NOT NULL,
  inventory      REAL NOT NULL,
  total_costs    REAL NOT NULL,
  profit         REAL NOT NULL,
  cum_profit     REAL NOT NULL,
  cash           REAL NOT NULL,
  brand          REAL NOT NULL,
  quality        REAL NOT NULL,
  sustainability REAL NOT NULL,
  market_share   REAL NOT NULL,
  score          REAL NOT NULL,
  rank           INTEGER NOT NULL,
  details_json   TEXT NOT NULL,
  PRIMARY KEY (round_id, group_id)
);

-- Registro attività (utile al docente per ricostruire cosa è successo)
CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  at      INTEGER NOT NULL
);
`);

function log(gameId, actor, action) {
  db.prepare('INSERT INTO audit_log (game_id, actor, action, at) VALUES (?,?,?,?)').run(gameId, actor, action, Date.now());
}

module.exports = { db, log, DB_PATH };
