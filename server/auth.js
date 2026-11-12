// Autenticazione e autorizzazione.
// - Docente: deve essere nella allowlist configurata lato server (config/teachers.json o env TEACHERS_JSON).
//   Non basta "essere autenticati": a ogni richiesta si ricontrolla che l'utente sia ancora attivo in allowlist.
// - Gruppo studenti: token casuale in cookie httpOnly, legato a UN gruppo e quindi a UNA sola partita.
// Il ruolo non viene mai letto da dati inviati dal browser.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const TEACHER_COOKIE = 'bg_teacher';
const GROUP_COOKIE = 'bg_group';
const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- utilità crittografiche ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

// Alfabeto senza caratteri ambigui (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  let out = '';
  const bytes = crypto.randomBytes(len * 2);
  for (let i = 0; out.length < len; i++) {
    const b = bytes[i % bytes.length];
    if (b < 248) out += CODE_ALPHABET[b % CODE_ALPHABET.length]; // evita bias del modulo
    if (i > len * 8) return randomCode(len);
  }
  return out;
}
const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatCode = (c) => c.slice(0, 4) + '-' + c.slice(4);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  try {
    const [algo, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
// PIN di rientro del gruppo: hash veloce va bene perché è legato a codice + nome gruppo + rate limit
const hashPin = (pin) => sha256('pin:' + normalizeCode(pin));

// ---------- allowlist docenti ----------
function loadAllowlist() {
  let list = [];
  if (process.env.TEACHERS_JSON) list = JSON.parse(process.env.TEACHERS_JSON);
  else {
    const file = process.env.TEACHERS_FILE || path.join(__dirname, '..', 'config', 'teachers.json');
    if (fs.existsSync(file)) list = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  list = list.filter((t) => t && t.email && t.passwordHash);
  // Modo semplice per la demo: un docente definito da variabili d'ambiente segrete dell'hosting
  // (TEACHER_EMAIL + TEACHER_PASSWORD). La password resta solo nelle impostazioni dell'hosting:
  // il server ne calcola l'hash all'avvio e non la scrive mai nel database.
  const envTeacher = envTeacherEntry();
  if (envTeacher && !list.some((t) => t.email.toLowerCase() === envTeacher.email)) list.push(envTeacher);
  return list;
}
let envTeacherCache = null;
let envTeacherWarned = false;
function envTeacherEntry() {
  const email = String(process.env.TEACHER_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.TEACHER_PASSWORD || '');
  if (!email) return null;
  if (!email.includes('@') || password.length < 10) {
    if (!envTeacherWarned) console.warn('ATTENZIONE: TEACHER_EMAIL deve essere un\'email e TEACHER_PASSWORD deve avere almeno 10 caratteri. Docente non creato.');
    envTeacherWarned = true;
    return null;
  }
  const key = sha256(email + '\n' + password);
  if (!envTeacherCache || envTeacherCache.key !== key) {
    envTeacherCache = { key, entry: { email, name: process.env.TEACHER_NAME || 'Docente', passwordHash: hashPassword(password) } };
  }
  return envTeacherCache.entry;
}

// Sincronizza la tabella users con la allowlist: chi non è più in lista viene disattivato.
function syncTeachers() {
  const list = loadAllowlist();
  const emails = new Set(list.map((t) => t.email.toLowerCase()));
  const tx = db.transaction(() => {
    for (const t of list) {
      db.prepare(`INSERT INTO users (email, name, role, active, password_hash) VALUES (?,?, 'teacher', 1, ?)
                  ON CONFLICT(email) DO UPDATE SET name = excluded.name, active = 1, password_hash = excluded.password_hash`)
        .run(t.email.toLowerCase(), t.name || t.email, t.passwordHash);
    }
    for (const u of db.prepare('SELECT id, email FROM users').all()) {
      if (!emails.has(u.email.toLowerCase())) {
        db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(u.id);
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(u.id);
      }
    }
  });
  tx();
  return list.length;
}

// ---------- cookie ----------
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeMs, cookiePath = '/') {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`, 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (IS_PROD) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

// ---------- sessioni docente ----------
function createTeacherSession(res, userId) {
  const token = randomToken();
  const now = Date.now();
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, now, now + TEACHER_SESSION_MS);
  setCookie(res, TEACHER_COOKIE, token, TEACHER_SESSION_MS);
}
function getTeacher(req) {
  const token = parseCookies(req)[TEACHER_COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at
                          FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now() || !row.active || row.role !== 'teacher') return null;
  return { id: row.id, email: row.email, name: row.name, role: 'teacher' };
}
function destroyTeacherSession(req, res) {
  const token = parseCookies(req)[TEACHER_COOKIE];
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
  setCookie(res, TEACHER_COOKIE, '', 0);
}

// ---------- token gruppo ----------
function createGroupToken(res, groupId) {
  const token = randomToken();
  db.prepare('INSERT INTO group_tokens (token_hash, group_id, created_at) VALUES (?,?,?)').run(sha256(token), groupId, Date.now());
  setCookie(res, GROUP_COOKIE, token, 60 * 24 * 60 * 60 * 1000);
}
function getGroup(req) {
  const token = parseCookies(req)[GROUP_COOKIE];
  if (!token) return null;
  return db.prepare(`SELECT g.id, g.game_id, g.name FROM group_tokens t JOIN groups g ON g.id = t.group_id
                     WHERE t.token_hash = ?`).get(sha256(token)) || null;
}
function clearGroupToken(req, res) {
  const token = parseCookies(req)[GROUP_COOKIE];
  if (token) db.prepare('DELETE FROM group_tokens WHERE token_hash = ?').run(sha256(token));
  setCookie(res, GROUP_COOKIE, '', 0);
}

// ---------- middleware ----------
function requireTeacher(req, res, next) {
  const teacher = getTeacher(req);
  if (!teacher) return res.status(401).json({ error: 'Accesso riservato al docente autorizzato.' });
  req.teacher = teacher;
  next();
}

// Controlla che la partita richiesta appartenga al docente: un docente non vede le partite di altri docenti.
function requireOwnGame(req, res, next) {
  const id = Number(req.params.gameId);
  const game = Number.isInteger(id) ? db.prepare('SELECT * FROM games WHERE id = ?').get(id) : null;
  if (!game || game.owner_id !== req.teacher.id) return res.status(404).json({ error: 'Partita non trovata.' });
  req.game = game;
  next();
}

// Gruppo studente: valida token + stato del codice della SUA partita (lato server, a ogni richiesta).
function requireGroup(req, res, next) {
  const group = getGroup(req);
  if (!group) return res.status(401).json({ error: 'Sessione non valida: inserisci di nuovo il codice.' });
  const code = db.prepare('SELECT status FROM access_codes WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(group.game_id);
  if (!code || code.status === 'suspended') {
    return res.status(403).json({ error: 'Il codice di questa sessione è stato sospeso dal docente.', codeStatus: code ? code.status : 'missing' });
  }
  req.group = group;
  req.codeStatus = code.status;
  next();
}

// Protezione CSRF: le richieste che modificano dati devono arrivare dalla nostra pagina.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'business-game') return res.status(403).json({ error: 'Richiesta non valida.' });
  const origin = req.get('Origin');
  if (origin) {
    const host = req.get('Host');
    try { if (new URL(origin).host !== host) return res.status(403).json({ error: 'Origine non valida.' }); }
    catch { return res.status(403).json({ error: 'Origine non valida.' }); }
  }
  next();
}

// Rate limit semplice in memoria (login docente, inserimento codici)
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Troppi tentativi. Riprova tra qualche minuto.' });
    arr.push(now);
    hits.set(k, arr);
    if (hits.size > 10000) hits.clear();
    next();
  };
}

module.exports = {
  sha256, randomToken, randomCode, normalizeCode, formatCode, hashPassword, verifyPassword, hashPin,
  syncTeachers, createTeacherSession, getTeacher, destroyTeacherSession,
  createGroupToken, getGroup, clearGroupToken,
  requireTeacher, requireOwnGame, requireGroup, csrfGuard, rateLimit,
};
