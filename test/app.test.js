// Test end-to-end: permessi, separazione delle sessioni, partita completa.
// Esegui con: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-test-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');
const { hashPassword } = require('../server/auth');
process.env.TEACHERS_JSON = JSON.stringify([
  { email: 'prof@scuola.it', name: 'Prof Uno', passwordHash: hashPassword('password-docente-1') },
  { email: 'altro@scuola.it', name: 'Prof Due', passwordHash: hashPassword('password-docente-2') },
]);
const { start } = require('../server/index');

let server, base;
before(() => new Promise((res) => { server = start(0); server.on('listening', () => { base = `http://127.0.0.1:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

// Client con cookie jar
function client() {
  const jar = {};
  return async (method, url, body, extraHeaders = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'business-game', ...extraHeaders };
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (Buffer.isBuffer(body)) headers['Content-Type'] = 'application/octet-stream';
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (r.headers.get('content-disposition')) data = { file: true, type: r.headers.get('content-type'), text };
    return { status: r.status, data };
  };
}

let prof, prof2, gameId, code, gameId2, code2;

test('il docente non autorizzato non accede', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/teacher/games')).status, 401);
  assert.equal((await anon('POST', '/api/teacher/login', { email: 'intruso@x.it', password: 'qualcosa' })).status, 401);
  assert.equal((await anon('POST', '/api/teacher/login', { email: 'prof@scuola.it', password: 'sbagliata' })).status, 401);
  // ruolo inviato dal browser ignorato
  assert.equal((await anon('GET', '/api/teacher/games', undefined, { 'X-Role': 'teacher' })).status, 401);
  // la pagina /docente mostra il login, non la dashboard
  const page = await anon('GET', '/docente');
  assert.match(page.data, /Accesso docente/);
});

test('il docente autorizzato crea due sessioni', async () => {
  prof = client();
  assert.equal((await prof('POST', '/api/teacher/login', { email: 'PROF@scuola.it', password: 'password-docente-1' })).status, 200);
  const page = await prof('GET', '/docente');
  assert.match(page.data, /Dashboard docente/);
  gameId = (await prof('POST', '/api/teacher/games', { name: 'Classe A', numRounds: 3 })).data.id;
  gameId2 = (await prof('POST', '/api/teacher/games', { name: 'Classe B' })).data.id;
  const g = (await prof('GET', `/api/teacher/games/${gameId}`)).data;
  code = g.code.code; code2 = (await prof('GET', `/api/teacher/games/${gameId2}`)).data.code.code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(code, code2);
  assert.equal(g.events.length, 9);
});

test('un altro docente non vede le sessioni del primo', async () => {
  prof2 = client();
  await prof2('POST', '/api/teacher/login', { email: 'altro@scuola.it', password: 'password-docente-2' });
  assert.equal((await prof2('GET', `/api/teacher/games/${gameId}`)).status, 404);
  assert.equal((await prof2('POST', `/api/teacher/games/${gameId}/state/start`)).status, 404);
  assert.deepEqual((await prof2('GET', '/api/teacher/games')).data, []);
});

test('CSRF: richieste senza header della pagina rifiutate', async () => {
  const r = await prof('POST', `/api/teacher/games/${gameId}/state/start`, {}, { 'X-Requested-With': 'altro' });
  assert.equal(r.status, 403);
  const r2 = await prof('POST', `/api/teacher/games/${gameId}/state/start`, {}, { Origin: 'https://evil.example' });
  assert.equal(r2.status, 403);
});

let s1, s2, s3, pin1;
test('studenti: codice errato rifiutato, codice valido accetta il gruppo', async () => {
  s1 = client(); s2 = client(); s3 = client();
  assert.equal((await s1('POST', '/api/student/check-code', { code: 'AAAA-AAAA' })).status, 404);
  const chk = await s1('POST', '/api/student/check-code', { code: code.toLowerCase() });
  assert.equal(chk.status, 200);
  assert.equal(chk.data.gameName, 'Classe A');
  const j = await s1('POST', '/api/student/join', { code, groupName: 'Alfa', members: 'Anna\nLuca' });
  assert.equal(j.status, 201); pin1 = j.data.pin; assert.ok(pin1);
  assert.equal((await s2('POST', '/api/student/join', { code, groupName: 'Beta' })).status, 201);
  // stesso nome senza PIN: rifiutato
  const dup = await s3('POST', '/api/student/join', { code, groupName: 'alfa' });
  assert.equal(dup.status, 403); assert.ok(dup.data.needPin);
  // gruppo nella sessione B
  assert.equal((await s3('POST', '/api/student/join', { code: code2, groupName: 'Gamma' })).status, 201);
});

test('lo studente non accede in alcun modo all\'area docente', async () => {
  assert.equal((await s1('GET', '/api/teacher/games')).status, 401);
  assert.equal((await s1('GET', `/api/teacher/games/${gameId}`)).status, 401);
  assert.equal((await s1('POST', `/api/teacher/games/${gameId}/rounds/open`, {})).status, 401);
  assert.match((await s1('GET', '/docente')).data, /Accesso docente/);
});

test('separazione studente/admin: ogni rotta docente rifiuta lo studente', async () => {
  // il codice dell'interfaccia docente non è scaricabile senza login docente
  assert.equal((await s1('GET', '/docente/app.js')).status, 404);
  assert.equal((await client()('GET', '/docente/app.js')).status, 404);
  assert.equal((await prof('GET', '/docente/app.js')).status, 200);
  const routes = [
    ['GET', '/api/teacher/me'], ['GET', '/api/teacher/games'], ['POST', '/api/teacher/games'],
    ['GET', `/api/teacher/games/${gameId}`], ['PATCH', `/api/teacher/games/${gameId}`],
    ...['start', 'pause', 'resume', 'close', 'reopen', 'debrief', 'end'].map((a) => ['POST', `/api/teacher/games/${gameId}/state/${a}`]),
    ['POST', `/api/teacher/games/${gameId}/rounds/open`], ['POST', `/api/teacher/games/${gameId}/rounds/close`],
    ['POST', `/api/teacher/games/${gameId}/code/status`], ['POST', `/api/teacher/games/${gameId}/code/regenerate`],
    ['POST', `/api/teacher/games/${gameId}/groups/1/recovery`], ['POST', `/api/teacher/games/${gameId}/groups/1/logout-devices`],
    ['DELETE', `/api/teacher/games/${gameId}/groups/1`], ['POST', `/api/teacher/games/${gameId}/events`],
    ['PUT', `/api/teacher/games/${gameId}/events/1`], ['DELETE', `/api/teacher/games/${gameId}/events/1`],
    ['GET', `/api/teacher/games/${gameId}/results`], ['GET', `/api/teacher/games/${gameId}/export.csv`],
  ];
  for (const [m, u] of routes) {
    const r = await s1(m, u, m === 'GET' ? undefined : { status: 'active', name: 'x' });
    assert.equal(r.status, 401, `${m} ${u} dovrebbe rifiutare lo studente`);
  }
  // token del gruppo spacciato come cookie docente, o cookie docente inventato: rifiutati
  const forged = client();
  const r1 = await fetch(base + '/api/teacher/games', { headers: { Cookie: 'bg_teacher=' + 'x'.repeat(43) } });
  assert.equal(r1.status, 401);
  const join = await fetch(base + '/api/student/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'business-game' }, body: JSON.stringify({ code, groupName: 'Spia' }) });
  const groupToken = join.headers.getSetCookie()[0].split(';')[0].split('=')[1];
  const r2 = await fetch(base + '/api/teacher/games', { headers: { Cookie: 'bg_teacher=' + groupToken } });
  assert.equal(r2.status, 401);
  // pulizia: elimina il gruppo di prova
  const g = (await prof('GET', `/api/teacher/games/${gameId}`)).data.groups.find((x) => x.name === 'Spia');
  await prof('DELETE', `/api/teacher/games/${gameId}/groups/${g.id}`);
  void forged;
});

test('startup e decisioni: vincoli di stato lato server', async () => {
  assert.equal((await s1('PUT', '/api/student/decision', { price: 200 })).status, 400); // nessun round
  assert.equal((await s1('PUT', '/api/student/startup', { name: 'Maison Alfa', segment: 'luxury', category: 'gioielli', market: 'EU' })).status, 200);
  assert.equal((await s2('PUT', '/api/student/startup', { name: 'maison alfa', segment: 'premium', category: 'abbigliamento', market: 'EU' })).status, 400); // nome duplicato
  assert.equal((await s2('PUT', '/api/student/startup', { name: 'Beta Wear', segment: 'premium', category: 'abbigliamento', market: 'EU' })).status, 200);
  assert.equal((await s2('PUT', '/api/student/startup', { name: 'X', segment: 'admin', category: 'abbigliamento', market: 'EU' })).status, 400);
  assert.equal((await s3('PUT', '/api/student/startup', { name: 'Gamma Lux', segment: 'luxury', category: 'accessori', market: 'US' })).status, 200);

  // round non apribile prima di avviare la sessione
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/rounds/open`, {})).status, 400);
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/state/start`)).status, 200);
  const ev = (await prof('GET', `/api/teacher/games/${gameId}`)).data.events;
  // evento di un'altra partita non accettato
  const evOther = (await prof('GET', `/api/teacher/games/${gameId2}`)).data.events[0].id;
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/rounds/open`, { eventIds: [evOther] })).status, 400);
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/rounds/open`, { eventIds: [ev[0].id] })).status, 200);

  const dec = { price: 950, production: 900, marketing: 60000, design: 40000, sustainability: 30000, channel: 'boutique', notes: 'posizionamento alto' };
  assert.equal((await s1('PUT', '/api/student/decision', dec)).status, 200);
  assert.equal((await s1('PUT', '/api/student/decision', { ...dec, price: -5 })).status, 400);
  assert.equal((await s1('PUT', '/api/student/decision', { ...dec, channel: 'x' })).status, 400);
  // il gruppo della sessione B non può decidere: nella sua partita non c'è round aperto
  assert.equal((await s3('PUT', '/api/student/decision', dec)).status, 400);

  // pausa: decisioni bloccate
  await prof('POST', `/api/teacher/games/${gameId}/state/pause`);
  assert.equal((await s2('PUT', '/api/student/decision', { ...dec, price: 190, production: 3000, channel: 'ecommerce' })).status, 400);
  await prof('POST', `/api/teacher/games/${gameId}/state/resume`);
  assert.equal((await s2('PUT', '/api/student/decision', { ...dec, price: 190, production: 3000, channel: 'ecommerce' })).status, 200);
});

test('isolamento: lo stato studente contiene solo i propri dati', async () => {
  const st = (await s1('GET', '/api/student/state')).data;
  assert.equal(st.gameName, 'Classe A');
  assert.equal(st.group.name, 'Alfa');
  assert.equal(st.openRound.decision.price, 950);
  assert.deepEqual(st.competitors.map((c) => c.name), ['Beta Wear']); // niente Gamma (altra sessione)
  assert.ok(!JSON.stringify(st).includes('Gamma'));
  const st3 = (await s3('GET', '/api/student/state')).data;
  assert.equal(st3.gameName, 'Classe B');
  assert.ok(!JSON.stringify(st3).includes('Maison Alfa'));
});

let fileId;
test('studio del gruppo e allegati: salvataggio e permessi', async () => {
  const a = { market: 'Dazi USA:\nnon ci toccano', competitors: 'Beta punta sul prezzo', strategy: 'Boutique', risks: 'Sostenibilità bassa', forecast_units: 600, forecast_profit: 150000 };
  assert.equal((await s1('PUT', '/api/student/analysis', a)).status, 200);
  assert.equal((await s1('PUT', '/api/student/analysis', { ...a, forecast_units: -3 })).status, 400);
  const st = (await s1('GET', '/api/student/state')).data;
  assert.equal(st.openRound.analysis.market, 'Dazi USA:\nnon ci toccano');
  // allegati: PDF ok, eseguibile camuffato rifiutato
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
  const up = await s1('POST', '/api/student/attachments', pdf, { 'X-Filename': encodeURIComponent('Studio mercato.pdf') });
  assert.equal(up.status, 201); fileId = up.data.id;
  assert.equal((await s1('POST', '/api/student/attachments', Buffer.from('MZ\x90\x00finto'), { 'X-Filename': 'virus.pdf' })).status, 400);
  assert.equal((await s1('POST', '/api/student/attachments', Buffer.from('PK\x03\x04xxxx'), { 'X-Filename': 'archivio.zip' })).status, 400);
  // il proprio gruppo scarica, un altro gruppo no, un'altra partita no
  const own = await s1('GET', `/api/student/attachments/${fileId}`);
  assert.equal(own.status, 200); assert.equal(own.data.type, 'application/pdf');
  assert.equal((await s2('GET', `/api/student/attachments/${fileId}`)).status, 404);
  assert.equal((await s3('GET', `/api/student/attachments/${fileId}`)).status, 404);
  assert.equal((await s2('DELETE', `/api/student/attachments/${fileId}`)).status, 404);
  // la docente lo scarica dalla propria partita, non da un'altra; uno studente non usa la rotta docente
  assert.equal((await prof('GET', `/api/teacher/games/${gameId}/attachments/${fileId}`)).status, 200);
  assert.equal((await prof('GET', `/api/teacher/games/${gameId2}/attachments/${fileId}`)).status, 404);
  assert.equal((await prof2('GET', `/api/teacher/games/${gameId}/attachments/${fileId}`)).status, 404);
  assert.equal((await s1('GET', `/api/teacher/games/${gameId}/attachments/${fileId}`)).status, 401);
  // la scheda del gruppo mostra analisi e allegato
  const g = (await prof('GET', `/api/teacher/games/${gameId}`)).data;
  const alfa = g.groups.find((x) => x.name === 'Alfa');
  const dossier = (await prof('GET', `/api/teacher/games/${gameId}/groups/${alfa.id}/dossier`)).data;
  assert.equal(dossier.rounds[0].analysis.strategy, 'Boutique');
  assert.equal(dossier.rounds[0].files[0].filename, 'Studio mercato.pdf');
});

test('chiusura round, KPI, classifica e salvataggio tra sessioni', async () => {
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/rounds/close`)).status, 200);
  const g = (await prof('GET', `/api/teacher/games/${gameId}`)).data;
  assert.equal(g.leaderboard.rows.length, 2);
  for (const r of g.leaderboard.rows) { assert.ok(Number.isFinite(r.score)); assert.ok(Number.isFinite(r.cash)); }
  const st1 = (await s1('GET', '/api/student/state')).data;
  assert.equal(st1.history.length, 1);
  assert.ok(st1.startupLocked);
  // la classifica pubblica non espone i dati finanziari degli altri gruppi
  assert.ok(st1.leaderboard.rows.every((r) => r.cash === undefined && r.revenue === undefined));
  // segmento bloccato dopo il primo round
  assert.equal((await s1('PUT', '/api/student/startup', { name: 'Maison Alfa', segment: 'premium', category: 'gioielli', market: 'EU' })).status, 400);

  // chiusura sessione 1 → stato salvato; avvio sessione 2 riprende da round 1
  await prof('POST', `/api/teacher/games/${gameId}/state/close`);
  let s = (await prof('GET', `/api/teacher/games/${gameId}`)).data.state;
  assert.equal(s.status, 'session_closed'); assert.equal(s.currentRound, 1);
  await prof('POST', `/api/teacher/games/${gameId}/state/reopen`);
  await prof('POST', `/api/teacher/games/${gameId}/state/close`);
  await prof('POST', `/api/teacher/games/${gameId}/state/start`);
  s = (await prof('GET', `/api/teacher/games/${gameId}`)).data.state;
  assert.equal(s.currentSession, 2); assert.equal(s.status, 'running');

  // rientro da un altro dispositivo con PIN
  const nuovoPc = client();
  assert.equal((await nuovoPc('POST', '/api/student/join', { code, groupName: 'Alfa', pin: 'SBAGLI' })).status, 403);
  assert.equal((await nuovoPc('POST', '/api/student/join', { code, groupName: 'ALFA', pin: pin1.toLowerCase() })).status, 200);
  assert.equal((await nuovoPc('GET', '/api/student/state')).data.history.length, 1);

  // round 2 senza decisione di Beta: decisione automatica
  await prof('POST', `/api/teacher/games/${gameId}/rounds/open`, { eventIds: [] });
  await s1('PUT', '/api/student/decision', { price: 980, production: 800, marketing: 80000, design: 40000, sustainability: 60000, channel: 'boutique' });
  await prof('POST', `/api/teacher/games/${gameId}/rounds/close`);
  const res = (await prof('GET', `/api/teacher/games/${gameId}/results`)).data;
  assert.equal(res.rows.length, 4);
  assert.ok(res.rows.some((r) => r.round === 2 && r.auto === 1));
});

test('codice sospeso blocca gli studenti, scaduto impedisce nuovi gruppi', async () => {
  await prof('POST', `/api/teacher/games/${gameId}/code/status`, { status: 'suspended' });
  assert.equal((await s1('GET', '/api/student/state')).status, 403);
  assert.equal((await client()('POST', '/api/student/check-code', { code })).status, 403);
  await prof('POST', `/api/teacher/games/${gameId}/code/status`, { status: 'expired' });
  assert.equal((await s1('GET', '/api/student/state')).status, 200);
  assert.equal((await client()('POST', '/api/student/join', { code, groupName: 'Nuovo' })).status, 403);
  await prof('POST', `/api/teacher/games/${gameId}/code/status`, { status: 'active' });
  // nuovo codice: il vecchio non funziona più, i gruppi restano collegati
  await prof('POST', `/api/teacher/games/${gameId}/code/regenerate`);
  assert.equal((await client()('POST', '/api/student/check-code', { code })).status, 404);
  assert.equal((await s1('GET', '/api/student/state')).status, 200);
});

test('eventi personalizzati, parametri, debriefing, fine partita, CSV', async () => {
  const add = await prof('POST', `/api/teacher/games/${gameId}/events`, { title: 'Guerra commerciale', description: 'Test', effects: { tariffByMarket: { EU: 0.2 }, costMultiplier: 1.1 } });
  assert.equal(add.status, 201);
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/events`, { title: '', effects: {} })).status, 400);
  assert.equal((await prof('PATCH', `/api/teacher/games/${gameId}`, { params: { startingCash: -1 } })).status, 400);
  assert.equal((await prof('PATCH', `/api/teacher/games/${gameId}`, { params: { outsideOption: 2 }, numRounds: 4 })).status, 200);
  await prof('POST', `/api/teacher/games/${gameId}/rounds/open`, { eventIds: [add.data.id] });
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/state/debrief`)).status, 400); // round aperto
  await prof('POST', `/api/teacher/games/${gameId}/rounds/close`);
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/state/debrief`)).status, 200);
  assert.equal((await prof('POST', `/api/teacher/games/${gameId}/state/end`)).status, 200);
  const g = (await prof('GET', `/api/teacher/games/${gameId}`)).data;
  assert.equal(g.code.status, 'expired');
  assert.equal(g.state.status, 'ended');
  const csv = await prof('GET', `/api/teacher/games/${gameId}/export.csv`);
  assert.match(csv.data.text, /round;gruppo;startup/);
  assert.equal((await s1('PUT', '/api/student/decision', { price: 1 })).status, 403);
});

test('giudizio finale: solo la docente, visibile agli studenti solo alla fine, ribalta la classifica', async () => {
  // nuova partita breve con due gruppi
  const gid = (await prof('POST', '/api/teacher/games', { name: 'Giudizio', numRounds: 1, params: { judgmentWeight: 0.6 } })).data.id;
  const c = (await prof('GET', `/api/teacher/games/${gid}`)).data.code.code;
  const a = client(), b = client();
  await a('POST', '/api/student/join', { code: c, groupName: 'A' });
  await b('POST', '/api/student/join', { code: c, groupName: 'B' });
  await a('PUT', '/api/student/startup', { name: 'Alta', segment: 'luxury', category: 'gioielli', market: 'EU' });
  await b('PUT', '/api/student/startup', { name: 'Bassa', segment: 'luxury', category: 'gioielli', market: 'EU' });
  await prof('POST', `/api/teacher/games/${gid}/state/start`);
  await prof('POST', `/api/teacher/games/${gid}/rounds/open`, {});
  await a('PUT', '/api/student/decision', { price: 950, production: 700, marketing: 90000, design: 60000, sustainability: 60000, channel: 'boutique' });
  await b('PUT', '/api/student/decision', { price: 300, production: 3000, marketing: 0, design: 0, sustainability: 0, channel: 'wholesale' });
  await prof('POST', `/api/teacher/games/${gid}/rounds/close`);
  const det = (await prof('GET', `/api/teacher/games/${gid}`)).data;
  const lb = det.leaderboard.rows;
  const winner = lb[0], loser = lb[1];
  const idOf = (name) => det.groups.find((g) => g.name === name).id;
  // la scomposizione del punteggio è presente
  const st = (await a('GET', '/api/student/state')).data;
  assert.ok(st.history[0].details.scoreParts.cumProfit.points >= 0);
  // lo studente non può dare voti
  assert.equal((await a('PUT', `/api/teacher/games/${gid}/groups/${idOf('A')}/evaluation`, { vote: 10 })).status, 401);
  assert.equal((await prof('PUT', `/api/teacher/games/${gid}/groups/${idOf('A')}/evaluation`, { vote: 11 })).status, 400);
  assert.equal((await prof('PUT', `/api/teacher/games/${gid}/groups/${idOf('A')}/evaluation`, { vote: 7.3 })).status, 400);
  // voto basso al vincitore, alto all'ultimo: con peso 60% la classifica si ribalta
  await prof('PUT', `/api/teacher/games/${gid}/groups/${winner.group_id}/evaluation`, { vote: 0, comment: 'Ragionamento assente', criteria: { market: 1 } });
  await prof('PUT', `/api/teacher/games/${gid}/groups/${loser.group_id}/evaluation`, { vote: 10, comment: 'Ottimo studio' });
  const fin = (await prof('GET', `/api/teacher/games/${gid}/final`)).data;
  assert.equal(fin.weight, 0.6); assert.ok(fin.allEvaluated);
  assert.equal(fin.rows[0].groupId, loser.group_id);
  assert.equal(fin.rows[0].finalScore, Math.round((loser.score * 0.4 + 60) * 100) / 100);
  assert.equal(fin.rows[0].movement, 1);
  // prima del debriefing gli studenti non vedono il giudizio
  assert.equal((await a('GET', '/api/student/state')).data.evaluation, null);
  await prof('POST', `/api/teacher/games/${gid}/state/debrief`);
  const sa = (await a('GET', '/api/student/state')).data;
  assert.ok(sa.evaluation); assert.ok(sa.leaderboard.final);
  const sb = (await b('GET', '/api/student/state')).data;
  assert.notEqual(sa.evaluation.comment, sb.evaluation.comment); // ognuno vede solo il proprio
  // un altro docente non vede né modifica
  assert.equal((await prof2('GET', `/api/teacher/games/${gid}/final`)).status, 404);
  assert.equal((await prof2('PUT', `/api/teacher/games/${gid}/groups/${idOf('A')}/evaluation`, { vote: 5 })).status, 404);
});

test('logout docente invalida la sessione', async () => {
  await prof('POST', '/api/teacher/logout');
  assert.equal((await prof('GET', '/api/teacher/games')).status, 401);
});
