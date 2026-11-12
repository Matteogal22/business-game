// Crea l'account del docente per la pubblicazione online.
// Genera una password sicura e stampa il valore da incollare nella variabile d'ambiente TEACHERS_JSON.
// Uso: npm run teacher-json -- docente@scuola.it "Prof. Nome Cognome"
//      (più docenti: ripeti il comando e unisci gli oggetti nella stessa lista [ ... , ... ])
const crypto = require('crypto');

const [email, name] = process.argv.slice(2);
if (!email || !email.includes('@') || !name) {
  console.error('Uso: npm run teacher-json -- <email> "<Nome Cognome>"');
  process.exit(1);
}
// stessa funzione di hashing del server (scrypt), senza aprire il database
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const bytes = crypto.randomBytes(16);
const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
const value = JSON.stringify([{ email: email.toLowerCase(), name, passwordHash: hashPassword(password) }]);

console.log('\n1) PASSWORD DEL DOCENTE (da inviare in privato, non viene salvata da nessuna parte):\n');
console.log('   ' + password);
console.log('\n2) VALORE DA INCOLLARE nella variabile TEACHERS_JSON dell\'hosting:\n');
console.log(value + '\n');
