// Aggiunge o aggiorna un docente nella allowlist (config/teachers.json).
// Uso: node scripts/add-teacher.js email@scuola.it "Nome Cognome" "password"
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../server/auth');

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 10) {
  console.error('Uso: node scripts/add-teacher.js <email> "<nome>" "<password di almeno 10 caratteri>"');
  process.exit(1);
}
const file = process.env.TEACHERS_FILE || path.join(__dirname, '..', 'config', 'teachers.json');
const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const entry = { email: email.toLowerCase(), name, passwordHash: hashPassword(password) };
const i = list.findIndex((t) => t.email.toLowerCase() === entry.email);
if (i >= 0) list[i] = entry; else list.push(entry);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(list, null, 2));
console.log(`Docente ${entry.email} salvato in ${file}. Per revocare l'accesso rimuovilo dal file.`);
