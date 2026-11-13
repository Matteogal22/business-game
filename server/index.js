const path = require('path');
const express = require('express');
const auth = require('./auth');
const { GameError } = require('./game');

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.disable('x-powered-by');

// Controllo di salute per l'hosting (non espone dati)
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// Configurazione pubblica minima (nessun dato riservato): serve solo a mostrare l'avviso "versione demo"
const DEMO = process.env.DEMO_MODE === '1';
app.get('/api/public/config', (req, res) => res.set('Cache-Control', 'no-store').json({ demo: DEMO }));

// Header di sicurezza: niente script inline, niente iframe, niente sniffing
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '50kb' }));

app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, auth.csrfGuard);
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Risorsa non trovata.' }));

// Area docente: l'indirizzo si sceglie con la variabile TEACHER_PATH (es. "gestione-bg-7k2q").
// Senza variabile resta /docente. L'indirizzo è solo un livello in più: la protezione vera è il login.
const fs = require('fs');
const RESERVED = ['api', 'css', 'js', 'healthz', 'index.html'];
function teacherPath() {
  const raw = String(process.env.TEACHER_PATH || 'docente').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(raw) || RESERVED.includes(raw.toLowerCase())) {
    console.error(`ERRORE: TEACHER_PATH "${raw}" non valido. Usa da 4 a 64 caratteri tra lettere, numeri, "-" e "_".`);
    process.exit(1);
  }
  return '/' + raw;
}
const TP = teacherPath();
const views = path.join(__dirname, 'views');
// Le pagine docente contengono l'indirizzo dello script: lo si inserisce al volo
const page = (file) => fs.readFileSync(path.join(views, file), 'utf8').replace(/__TEACHER_PATH__/g, TP);
app.use(TP, (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.get([TP, TP + '/'], (req, res) => {
  res.type('html').send(page(auth.getTeacher(req) ? 'teacher-dashboard.html' : 'teacher-login.html'));
});
// Anche il codice della dashboard viene servito solo al docente autorizzato:
// uno studente non può nemmeno scaricare l'interfaccia di amministrazione.
app.get(TP + '/app.js', (req, res) => {
  if (!auth.getTeacher(req)) return res.status(404).type('text/plain').send('Non trovato');
  res.type('application/javascript').send(page('teacher-app.js'));
});
app.use(TP, (req, res) => res.status(404).type('text/plain').send('Non trovato'));

// Area studenti
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

// Gestione errori
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dati non validi.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File troppo grande (massimo 10 MB).' });
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Elemento già esistente.' });
  console.error(err);
  res.status(500).json({ error: 'Errore interno.' });
});

function start(port = Number(process.env.PORT) || 3000) {
  let n;
  try { n = auth.syncTeachers(); }
  catch (e) {
    console.error('ERRORE: la lista dei docenti (TEACHERS_JSON o config/teachers.json) non è un JSON valido:', e.message);
    process.exit(1);
  }
  if (!n) console.warn('ATTENZIONE: nessun docente in allowlist. Crea config/teachers.json (vedi README).');
  // Ricarica la allowlist ogni minuto: rimuovere un docente dal file revoca l'accesso senza riavvio
  setInterval(() => { try { auth.syncTeachers(); } catch (e) { console.error('Allowlist non valida:', e.message); } }, 60000).unref();
  return app.listen(port, () => console.log(`Business game su http://localhost:${port}  (area docente: ${TP})`));
}

if (require.main === module) start();
module.exports = { app, start };
