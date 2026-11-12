// Dashboard docente
(function () {
  const { api, esc, eur, num, $, $$, badge, codeBadge, SEG, MKT, CH, makeTimer, ringHTML, clock } = window.BG;
  let games = [];
  let currentId = null;
  let d = null;            // dettaglio partita corrente
  let roundKey = null;
  let settingsFor = null;
  let poll = null;
  let eventsFor = null;
  $('#dRing').innerHTML = ringHTML();
  const host = location.host;
  // Il timer aggiorna anche la modalità proiezione
  const timer = makeTimer($('#dRing'), ({ main, cap, t, base }) => {
    if ($('#projector').classList.contains('hidden')) return;
    $('#pTimer').textContent = main;
    $('#pTimer').classList.toggle('over', t.over && !!base.currentSession);
    $('#pCap').textContent = cap;
    $('#pBar').style.width = (base.currentSession ? Math.round(t.left * 100) : 100) + '%';
  });
  const msg = (el, text, kind = 'err') => { $(el).innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ''; };

  async function act(fn, okText) {
    try { await fn(); if (okText) msg('#actionMsg', okText, 'ok'); await loadDetail(); await loadGames(); }
    catch (err) { msg('#actionMsg', err.message); if (err.status === 401) location.reload(); }
  }

  // ---------- sessione docente ----------
  api('GET', '/api/teacher/me').then((me) => { $('#me').textContent = me.name + ' · ' + me.email; }).catch(() => location.reload());
  $('#logoutBtn').addEventListener('click', async () => { await api('POST', '/api/teacher/logout').catch(() => {}); location.href = '/docente'; });

  // ---------- elenco e creazione ----------
  async function loadGames() {
    games = await api('GET', '/api/teacher/games');
    $('#gameList').innerHTML = games.length ? games.map((g) => `<button data-id="${g.id}" class="${g.id === currentId ? 'active' : ''}">
      <span>${esc(g.name)}<small>${g.groups_count} gruppi · round ${g.current_round}/${g.num_rounds}</small></span>${badge(g.status)}</button>`).join('')
      : '<p class="muted">Nessuna sessione ancora.</p>';
  }
  $('#gameList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) select(Number(b.dataset.id));
  });
  // Preset di difficoltà (stessi valori del server, server/defaults.js)
  const PRESETS = {
    facile: { label: 'Facile', desc: 'Più clienti e più cassa iniziale. Gli errori si recuperano: adatto a chi è alle prime armi.',
      startingCash: 700000, fixedCostPerRound: 30000, outsideOption: 1.0, segments: { premium: { baseDemand: 14000, elasticity: 1.3 }, luxury: { baseDemand: 3000, elasticity: 0.4 } } },
    standard: { label: 'Standard', desc: 'Equilibrato: le buone scelte si vedono, quelle sbagliate costano.',
      startingCash: 500000, fixedCostPerRound: 40000, outsideOption: 1.5, segments: { premium: { baseDemand: 12000, elasticity: 1.5 }, luxury: { baseDemand: 2500, elasticity: 0.5 } } },
    sfidante: { label: 'Sfidante', desc: 'Mercato più piccolo e clienti più esigenti. Per master e gruppi esperti.',
      startingCash: 400000, fixedCostPerRound: 50000, outsideOption: 2.2, segments: { premium: { baseDemand: 10000, elasticity: 1.8 }, luxury: { baseDemand: 2000, elasticity: 0.65 } } },
  };
  const presetHTML = (selected) => Object.entries(PRESETS).map(([k, p]) => `<button type="button" class="preset ${selected === k ? 'on' : ''}" data-preset="${k}"><b>${p.label}${selected === k ? ' ✓' : ''}</b><span>${p.desc}</span></button>`).join('')
    + (selected === 'personalizzato' ? '<div class="preset on static"><b>Personalizzato ✓</b><span>Hai modificato le impostazioni avanzate.</span></div>' : '');
  const weightHelp = (w) => w === 0 ? 'Il tuo voto non cambia la classifica: contano solo i risultati del gioco.'
    : `Il punteggio finale sarà per il <b>${100 - w}%</b> il risultato del gioco e per il <b>${w}%</b> il tuo voto sullo studio dei gruppi.`;

  let ngPreset = 'standard';
  function updateCreateCalc() {
    const f = $('#newGameForm');
    const L = Math.max(1, Number(f.numSessions.value) || 1), R = Math.max(1, Number(f.numRounds.value) || 1), M = Math.max(10, Number(f.sessionMinutes.value) || 90);
    const per = R / L;
    const usable = Math.max(10, M - 20);
    const minutes = Math.round(usable / Math.max(1, Math.ceil(per)));
    $('#ngCalc').innerHTML = `<b>${R} round in ${L} ${L === 1 ? 'lezione' : 'lezioni'}</b>: circa <b>${Number.isInteger(per) ? per : per.toFixed(1).replace('.', ',')} round a lezione</b>, con circa <b>${minutes} minuti per round</b> togliendo introduzione e commenti.`;
    let r = 1, out = '';
    for (let l = 1; l <= L; l++) {
      const n = Math.round((R * l) / L) - Math.round((R * (l - 1)) / L);
      const range = n > 0 ? (n === 1 ? `Round ${r}` : `Round ${r}–${r + n - 1}`) : 'Ripasso';
      out += `<div><b>Lezione ${l}</b>${range}${l === L ? ' + debriefing' : ''}</div>`;
      r += n;
    }
    $('#ngLessons').innerHTML = out;
    const w = Number(f.judgmentWeight.value);
    $('#ngWeightVal').textContent = w + '%';
    $('#ngWeightHelp').innerHTML = weightHelp(w);
    $('#ngPresets').innerHTML = presetHTML(ngPreset);
  }
  $('#newGameBtn').addEventListener('click', () => {
    $('#createView').classList.remove('hidden');
    $('#detail').classList.add('hidden'); $('#empty').classList.add('hidden');
    clearInterval(poll); currentId = null;
    $$('#gameList button').forEach((b) => b.classList.remove('active'));
    updateCreateCalc();
    $('#newGameForm').name.focus();
  });
  $('#createCancel').addEventListener('click', () => {
    $('#createView').classList.add('hidden');
    if (games.length) select(games[0].id); else $('#empty').classList.remove('hidden');
  });
  $('#newGameForm').addEventListener('input', updateCreateCalc);
  $('#ngPresets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) { ngPreset = b.dataset.preset; updateCreateCalc(); } });
  $('#newGameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const p = PRESETS[ngPreset];
    try {
      const r = await api('POST', '/api/teacher/games', {
        name: f.name.value, numSessions: f.numSessions.value, sessionMinutes: f.sessionMinutes.value,
        numRounds: f.numRounds.value, leaderboardPublic: f.leaderboardPublic.checked,
        params: { preset: ngPreset, judgmentWeight: Number(f.judgmentWeight.value) / 100, startingCash: p.startingCash, fixedCostPerRound: p.fixedCostPerRound, outsideOption: p.outsideOption, segments: p.segments },
      });
      f.name.value = '';
      msg('#newGameMsg', '');
      $('#createView').classList.add('hidden');
      await loadGames();
      select(r.id);
    } catch (err) { msg('#newGameMsg', err.message); }
  });

  async function select(id) {
    currentId = id; roundKey = null; settingsFor = null; eventsFor = null;
    closeDossier();
    msg('#actionMsg', '');
    $$('#gameList button').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === id));
    await loadDetail();
    $('#createView').classList.add('hidden');
    $('#empty').classList.add('hidden');
    $('#detail').classList.remove('hidden');
    clearInterval(poll);
    poll = setInterval(() => loadDetail().catch(() => {}), 5000);
  }

  async function loadDetail() {
    if (!currentId) return;
    d = await api('GET', `/api/teacher/games/${currentId}`);
    render();
  }

  // ---------- tab ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('section[data-panel]').forEach((s) => s.classList.toggle('hidden', s.dataset.panel !== b.dataset.tab));
    if (b.dataset.tab === 'debrief') loadResults();
  });

  // ---------- render ----------
  function render() {
    const s = d.state;
    const withStartup = d.groups.filter((g) => g.startup_name).length;
    const leader = d.leaderboard.rows[0];
    $('#dName').textContent = d.game.name;
    $('#dEyebrow').textContent = s.currentSession ? `Sessione d'aula ${s.currentSession} di ${s.numSessions}` : 'Partita non ancora avviata';
    $('#dStatus').innerHTML = badge(s.status);
    $('#dSub').textContent = s.roundOpen
      ? `Round ${s.currentRound} aperto · ${d.currentDecisions.length} di ${withStartup} gruppi hanno deciso`
      : s.currentRound ? `Ultimo round calcolato: ${s.currentRound}` : 'Nessun round ancora giocato';
    $('#dSession').innerHTML = `${s.currentSession || '–'} <small>/ ${s.numSessions}</small>`;
    $('#dRound').innerHTML = `${s.currentRound} <small>/ ${s.numRounds}</small>`;
    $('#dGroups').textContent = d.groups.length;
    $('#dDecisions').innerHTML = s.roundOpen ? `${d.currentDecisions.length} <small>/ ${withStartup}</small>` : '–';
    $('#dLeader').textContent = leader ? leader.startup_name : '–';
    $('#dCode').textContent = d.code.code;
    $('#dCodeStatus').innerHTML = codeBadge(d.code.status);
    $('#dUrl').textContent = host;
    renderProjector();
    timer.set({ ...s });
    renderSessionControls();
    renderRound();
    renderCode();
    renderLog();
    renderGroups();
    renderBoard();
    renderEvents();
    if (settingsFor !== d.game.id) fillSettings();
  }

  function renderSessionControls() {
    const st = d.state.status, s = d.state;
    const nextN = s.currentSession + 1;
    const btns = [
      ['start', `Avvia sessione ${nextN}`, ['setup', 'session_closed'].includes(st) && s.currentSession < s.numSessions, ''],
      ['pause', 'Metti in pausa', st === 'running', 'secondary'],
      ['resume', 'Riprendi', st === 'paused', ''],
      ['close', `Chiudi sessione ${s.currentSession || ''}`, ['running', 'paused'].includes(st), 'secondary'],
      ['reopen', `Riapri sessione ${s.currentSession || ''}`, ['session_closed', 'debrief'].includes(st) && s.currentSession > 0, 'secondary'],
      ['debrief', 'Avvia debriefing', !['setup', 'ended', 'debrief'].includes(st) && !s.roundOpen, 'secondary'],
      ['end', 'Termina partita', st !== 'ended' && !s.roundOpen, 'danger'],
    ];
    // Mostra solo le azioni possibili nello stato attuale: interfaccia più pulita
    const visible = btns.filter(([, , en]) => en);
    const primary = { start: 1, resume: 1 };
    $('#sessionControls').innerHTML = visible.map(([a, l, , cls]) => `<button data-action="${a}" class="${primary[a] ? 'solid' : cls}">${esc(l)}</button>`).join('')
      || '<span class="sub">Partita conclusa.</span>';
    $('#sessionChips').innerHTML = d.sessions.map((x) => `<span class="badge ${x.status === 'running' ? 'ok' : x.status === 'paused' ? 'warn' : x.status === 'closed' ? 'info' : 'muted'}">Sessione ${x.number} · ${esc({ pending: 'da fare', running: 'in corso', paused: 'in pausa', closed: 'chiusa' }[x.status])}${x.status !== 'pending' ? ' · ' + clock(x.elapsed_ms) : ''}</span>`).join('');
  }
  $('#sessionControls').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'end' && !confirm('Terminare definitivamente la partita? Il codice scadrà e non si potranno più giocare round.')) return;
    if (a === 'close' && d.state.roundOpen && !confirm('C\'è un round aperto: resterà aperto ma gli studenti non potranno modificarlo finché non riapri o avvii la sessione successiva. Chiudere la sessione?')) return;
    act(() => api('POST', `/api/teacher/games/${currentId}/state/${a}`), {
      start: 'Sessione avviata.', pause: 'Sessione in pausa.', resume: 'Sessione ripresa.', close: 'Sessione chiusa: lo stato è salvato.',
      reopen: 'Sessione riaperta.', debrief: 'Debriefing avviato: gli studenti vedono la classifica finale.', end: 'Partita terminata.',
    }[a]);
  });

  function renderRound() {
    const s = d.state;
    const open = d.rounds.find((r) => r.status === 'open');
    if (open) {
      roundKey = 'open';
      const withStartup = d.groups.filter((g) => g.startup_name);
      const sent = new Map(d.currentDecisions.map((x) => [x.groupId, x]));
      $('#roundBox').innerHTML = `<div class="row"><div><h2>Round ${open.number}</h2><p class="lead">Le decisioni restano modificabili finché non chiudi il round.</p></div><span class="spacer"></span><span class="badge info">${sent.size} di ${withStartup.length} inviate</span></div>
        ${open.events.length ? open.events.map((e) => `<div class="event"><div><strong>${esc(e.title)}</strong>${esc(e.description)}</div></div>`).join('') : '<p class="muted">Nessun evento attivo in questo round.</p>'}
        <div class="progress"><i id="decProgress"></i></div>
        <div class="table-wrap"><table><thead><tr><th>Gruppo</th><th class="n">Prezzo</th><th class="n">Produzione</th><th class="n">Marketing</th><th class="n">Design</th><th class="n">Sostenib.</th><th>Canale</th><th>Studio</th></tr></thead><tbody>
        ${withStartup.map((g) => { const x = sent.get(g.id); const dd = x && x.decision; return `<tr><td>${groupCell(g)}</td>
          ${dd ? `<td class="n">${eur(dd.price)}</td><td class="n">${num(dd.production)}</td><td class="n">${eur(dd.marketing)}</td><td class="n">${eur(dd.design)}</td><td class="n">${eur(dd.sustainability)}</td><td>${esc(CH[dd.channel])}</td><td>${x.studied ? '<span class="badge info">Inviato</span>' : '<span class="badge muted">Non ancora</span>'}</td>`
          : '<td colspan="7"><span class="badge warn">In attesa</span></td>'}</tr>`; }).join('')}
        </tbody></table></div>
        <p class="muted mt"><small>Chi non invia ripete automaticamente l'ultima decisione (o una decisione standard al primo round).</small></p>
        <button id="closeRoundBtn" class="primary-blue">Chiudi round ${open.number} e calcola risultati</button>`;
      $('#decProgress').style.width = (withStartup.length ? Math.round((sent.size / withStartup.length) * 100) : 0) + '%';
      $('#closeRoundBtn').addEventListener('click', () => {
        const missing = withStartup.length - sent.size;
        if (missing > 0 && !confirm(`${missing} gruppi non hanno inviato decisioni. Chiudere comunque?`)) return;
        act(() => api('POST', `/api/teacher/games/${currentId}/rounds/close`), `Round ${open.number} calcolato.`);
      });
      return;
    }
    const key = [s.status, s.currentRound, s.numRounds, d.events.map((e) => e.id + e.title).join(',')].join('|');
    if (key === roundKey) return;
    roundKey = key;
    const canOpen = s.status === 'running' && s.currentRound < s.numRounds;
    const n = s.currentRound + 1;
    $('#roundBox').innerHTML = `<h2>${s.currentRound >= s.numRounds ? 'Tutti i round sono stati giocati' : `Prossimo round: ${n} di ${s.numRounds}`}</h2>
      ${s.currentRound < s.numRounds ? `<p class="lead">Seleziona gli eventi geopolitici da annunciare, poi apri il round.</p>
      ${s.status !== 'running' ? '<div class="msg info">Per aprire un round la sessione d\'aula deve essere in corso.</div>' : ''}
      <div class="grid2">${d.events.map((e) => `<label class="check check-card"><input type="checkbox" value="${e.id}"><span><strong>${esc(e.title)}</strong><small>${esc(e.description)}</small></span></label>`).join('')}</div>
      <p class="mt"><button id="openRoundBtn" class="primary-blue" ${canOpen ? '' : 'disabled'}>Apri round ${n}</button></p>` : '<p class="lead">Puoi avviare il debriefing o aumentare il numero di round nelle impostazioni.</p>'}`;
    const btn = $('#openRoundBtn');
    if (btn) btn.addEventListener('click', () => {
      const eventIds = $$('#roundBox input[type=checkbox]:checked').map((c) => Number(c.value));
      act(() => api('POST', `/api/teacher/games/${currentId}/rounds/open`, { eventIds }), `Round ${n} aperto.`);
    });
  }

  function renderCode() {
    const c = d.code.status, ended = d.state.status === 'ended';
    $('#codeControls').innerHTML = `${codeBadge(c)}<span class="spacer"></span>
      <button data-code="active" ${c === 'active' || ended ? 'disabled' : ''}>Attiva</button>
      <button data-code="suspended" class="secondary" ${c === 'suspended' ? 'disabled' : ''}>Sospendi</button>
      <button data-code="expired" class="secondary" ${c === 'expired' ? 'disabled' : ''}>Fai scadere</button>
      <button data-code="regenerate" class="danger" ${ended ? 'disabled' : ''}>Nuovo codice</button>`;
  }
  $('#codeControls').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (!b) return;
    const v = b.dataset.code;
    if (v === 'regenerate') {
      if (!confirm('Generare un nuovo codice? Il codice attuale smetterà di funzionare.')) return;
      return act(() => api('POST', `/api/teacher/games/${currentId}/code/regenerate`), 'Nuovo codice generato.');
    }
    act(() => api('POST', `/api/teacher/games/${currentId}/code/status`, { status: v }), 'Stato del codice aggiornato.');
  });

  function renderLog() {
    $('#logBox').innerHTML = `<table><tbody>${d.log.map((l) => `<tr><td><small>${new Date(l.at).toLocaleString('it-IT')}</small></td><td><small>${esc(l.actor)}</small></td><td>${esc(l.action)}</td></tr>`).join('')}</tbody></table>`;
  }

  // Cella gruppo con iniziali: nome del gruppo + startup (o segmento)
  const initials = (t) => String(t || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  function groupCell(g) {
    const title = g.startup_name || g.name;
    const sub = g.startup_name ? `${esc(g.name)} · ${esc(SEG[g.segment] || '')} · ${esc(MKT[g.market] || '')}` : 'startup da configurare';
    return `<div class="gcell"><div class="mono">${esc(initials(title))}</div><div>${esc(title)}<small>${sub}</small></div></div>`;
  }

  // ---------- proiezione in aula ----------
  function renderProjector() {
    const s = d.state;
    $('#pTitle').textContent = d.game.name;
    $('#pUrl').textContent = host;
    $('#pCode').textContent = d.code.code;
    $('#pMeta').innerHTML = `<span>Sessione <b>${s.currentSession || '–'}/${s.numSessions}</b></span><span>Round <b>${s.currentRound}/${s.numRounds}</b>${s.roundOpen ? ' · aperto' : ''}</span><span>${badge(s.status)}</span>`;
  }
  function openProjector() {
    renderProjector();
    $('#projector').classList.remove('hidden');
    timer.set({ ...d.state });
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  function closeProjector() {
    $('#projector').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $('#projectBtn').addEventListener('click', openProjector);
  $('#projClose').addEventListener('click', closeProjector);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProjector(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) $('#projector').classList.add('hidden'); });
  $('#copyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(d.code.code); $('#copyBtn').textContent = 'Copiato ✓'; }
    catch { $('#copyBtn').textContent = 'Copia non riuscita'; }
    setTimeout(() => { $('#copyBtn').textContent = 'Copia codice'; }, 1600);
  });

  function renderGroups() {
    if (!d.groups.length) { $('#groupsBox').innerHTML = '<p class="muted">Nessun gruppo ancora registrato. Comunica agli studenti il codice e l\'indirizzo del sito.</p>'; return; }
    const open = d.state.roundOpen;
    const sent = new Map(d.currentDecisions.map((x) => [x.groupId, x]));
    $('#groupsBox').innerHTML = `<table><thead><tr><th>Startup / gruppo</th><th>Componenti</th><th class="n">Dispositivi</th>${open ? '<th>Round in corso</th>' : ''}<th>Giudizio finale</th><th></th></tr></thead><tbody>
      ${d.groups.map((g) => { const x = sent.get(g.id); return `<tr><td>${groupCell(g)}</td><td><small>${esc(g.members.join(', ')) || '–'}</small></td><td class="n">${g.devices}</td>
        ${open ? `<td>${x ? '<span class="badge ok">Decisioni inviate</span>' + (x.studied ? ' <span class="badge info">Studio</span>' : ' <span class="badge muted">Senza studio</span>') : '<span class="badge warn">In attesa</span>'}</td>` : ''}
        <td>${g.vote !== null ? `<span class="badge info">${num(g.vote, 1)} / 10</span>` : '<span class="badge muted">Da valutare</span>'}</td>
        <td><div class="controls"><button class="small" data-dossier="${g.id}">Apri scheda</button><button class="small secondary" data-pin="${g.id}">Nuovo PIN</button><button class="small secondary" data-logout="${g.id}">Scollega</button><button class="small danger" data-del="${g.id}">Elimina</button></div></td></tr>`; }).join('')}
      </tbody></table>`;
  }
  $('#groupsBox').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dossier) return openDossier(Number(b.dataset.dossier));
    try {
      if (b.dataset.pin) {
        if (!confirm('Generare un nuovo PIN di rientro per questo gruppo? Il vecchio non funzionerà più.')) return;
        const r = await api('POST', `/api/teacher/games/${currentId}/groups/${b.dataset.pin}/recovery`);
        msg('#groupsMsg', `Nuovo PIN di rientro: ${r.pin} — comunicalo al gruppo.`, 'ok');
      } else if (b.dataset.logout) {
        await api('POST', `/api/teacher/games/${currentId}/groups/${b.dataset.logout}/logout-devices`);
        msg('#groupsMsg', 'Dispositivi scollegati. Per rientrare il gruppo userà codice + PIN.', 'ok');
      } else if (b.dataset.del) {
        if (!confirm('Eliminare il gruppo? Possibile solo se non ha ancora risultati.')) return;
        await api('DELETE', `/api/teacher/games/${currentId}/groups/${b.dataset.del}`);
        msg('#groupsMsg', 'Gruppo eliminato.', 'ok');
      }
      await loadDetail();
    } catch (err) { msg('#groupsMsg', err.message); }
  });

  // ---------- scheda del gruppo + giudizio finale ----------
  const CRIT = { market: 'Lettura del mercato e degli eventi', strategy: 'Coerenza della strategia', forecast: 'Qualità delle previsioni', risks: 'Gestione dei rischi' };
  const PARTS = { cumProfit: 'Utile cumulato', brand: 'Forza del brand', marketShare: 'Quota di mercato', sustainability: 'Sostenibilità', cash: 'Cassa' };
  let dossier = null, dossierRound = 'all', evalDraft = null;
  function showTab(name) {
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    $$('section[data-panel]').forEach((sec) => sec.classList.toggle('hidden', sec.dataset.panel !== name));
  }
  async function openDossier(groupId) {
    try {
      dossier = await api('GET', `/api/teacher/games/${currentId}/groups/${groupId}/dossier`);
      const played = dossier.rounds.filter((r) => r.kpi || r.decision);
      dossierRound = 'all';
      evalDraft = dossier.evaluation ? { vote: dossier.evaluation.vote, criteria: { ...dossier.evaluation.criteria }, comment: dossier.evaluation.comment } : { vote: null, criteria: {}, comment: '' };
      showTab('groups');
      $('#groupsList').classList.add('hidden');
      $('#dossierView').classList.remove('hidden');
      renderDossier(played);
      window.scrollTo({ top: $('#tabs').offsetTop - 70, behavior: 'smooth' });
    } catch (err) { msg('#groupsMsg', err.message); }
  }
  function closeDossier() { $('#dossierView').classList.add('hidden'); $('#groupsList').classList.remove('hidden'); dossier = null; }

  const textBlock = (title, t) => `<div class="an-block"><b>${title}</b>${t && t.trim() ? esc(t).replace(/\n/g, '<br>') : '<span class="muted">non compilato</span>'}</div>`;
  function roundBlock(r) {
    const k = r.kpi, dd = r.decision, a = r.analysis;
    const parts = k && k.details.scoreParts;
    const delta = (pred, real) => { if (pred == null || real == null) return ''; const p = pred === 0 ? 0 : Math.round(((real - pred) / Math.abs(pred)) * 100); return ` <em class="${Math.abs(p) <= 15 ? 'ok' : 'w'}">${p > 0 ? '+' : ''}${p}%</em>`; };
    return `<div class="round-card">
      <div class="row"><b class="rtitle">Round ${r.number}</b>${r.events.map((e) => `<span class="badge info">${esc(e.title)}</span>`).join(' ')}<span class="spacer"></span>
        ${k ? `<span class="badge ok">${k.rank}° posto · ${num(k.score, 1)} pt</span>` : `<span class="badge muted">${r.status === 'open' ? 'Round in corso' : 'Non giocato'}</span>`}</div>
      ${dd ? `<div class="dec-grid">
        <div><span>Prezzo</span><b>${eur(dd.price)}</b></div><div><span>Produzione</span><b>${num(dd.production)}</b></div><div><span>Marketing</span><b>${eur(dd.marketing)}</b></div>
        <div><span>Design</span><b>${eur(dd.design)}</b></div><div><span>Sostenibilità</span><b>${eur(dd.sustainability)}</b></div><div><span>Canale</span><b>${esc(CH[dd.channel] || dd.channel)}</b></div></div>
        ${r.auto ? '<div class="msg warn">Decisione ripetuta automaticamente: il gruppo non ha inviato in tempo.</div>' : ''}` : '<p class="muted">Nessuna decisione.</p>'}
      <div class="an-grid">${textBlock('Mercato ed eventi', a && a.market)}${textBlock('Concorrenti', a && a.competitors)}${textBlock('Strategia e alternative', a && a.strategy)}${textBlock('Rischi', a && a.risks)}</div>
      <div class="fc-grid">
        <div><span>Pezzi venduti</span><b>${a && a.forecast_units != null ? `previsti ${num(a.forecast_units)} → ` : ''}${k ? `reali ${num(k.units_sold)}` : '–'}${delta(a && a.forecast_units, k && k.units_sold)}</b></div>
        <div><span>Utile del round</span><b>${a && a.forecast_profit != null ? `previsto ${eur(a.forecast_profit)} → ` : ''}${k ? `reale ${eur(k.profit)}` : '–'}${delta(a && a.forecast_profit, k && k.profit)}</b></div>
        <div><span>Allegati</span><b>${r.files.length ? r.files.map((f) => `<a href="/api/teacher/games/${currentId}/attachments/${f.id}">${esc(f.filename)}</a>`).join('<br>') : 'nessuno'}</b></div>
      </div>
      ${parts ? `<details class="mt"><summary class="muted">Da cosa nasce il punteggio di questo round</summary>${Object.entries(parts).map(([key, p]) => `<div class="sb"><div class="t">${PARTS[key]} <span>${Math.round(p.weight * 100)}% · ${num(p.points)} pt</span></div><div class="bar"><i data-w="${p.points}" class="${p.points < 35 ? 'low' : ''}"></i></div></div>`).join('')}</details>` : ''}
    </div>`;
  }
  function renderDossier(played) {
    const g = dossier.group, st = dossier.startup;
    const list = played || dossier.rounds.filter((r) => r.kpi || r.decision);
    const shown = dossierRound === 'all' ? list : list.filter((r) => r.number === dossierRound);
    const lastK = [...dossier.rounds].reverse().find((r) => r.kpi);
    const gameScore = lastK ? lastK.kpi.score : null;
    const w = Math.round(dossier.weight * 100);
    $('#dossierView').innerHTML = `
      <div class="panel">
        <div class="row"><button class="secondary small" id="dosBack">← Tutti i gruppi</button></div>
        <div class="ghead mt"><div class="mono big-mono">${esc(((st && st.name) || g.name).split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase())}</div>
          <div><h2>${esc(st ? st.name : g.name)}</h2><small class="muted">Gruppo ${esc(g.name)}${st ? ` · ${esc(SEG[st.segment])} · ${esc(st.category)} · ${esc(MKT[st.market])}` : ''}${g.members.length ? ' · ' + esc(g.members.join(', ')) : ''}</small>
          ${st && (st.positioning || st.values_text) ? `<p class="help">${st.positioning ? '<b>Posizionamento:</b> ' + esc(st.positioning) + ' ' : ''}${st.values_text ? '<b>Valori:</b> ' + esc(st.values_text) : ''}</p>` : ''}</div></div>
      </div>
      <div class="dossier">
        <div>
          ${list.length ? `<nav class="tabs" id="dosRounds">${list.map((r) => `<button data-r="${r.number}" class="${dossierRound === r.number ? 'active' : ''}">Round ${r.number}</button>`).join('')}<button data-r="all" class="${dossierRound === 'all' ? 'active' : ''}">Tutti</button></nav>` : ''}
          ${shown.length ? shown.map(roundBlock).join('') : '<div class="panel"><p class="muted">Il gruppo non ha ancora giocato nessun round.</p></div>'}
        </div>
        <aside class="panel eval">
          <h2>Giudizio finale</h2>
          <p class="help">Valuta il ragionamento del gruppo su tutto il percorso. Il gruppo vedrà voto e commento solo nel debriefing.</p>
          <div class="lab-row mt"><label>Voto (0–10)</label><span class="hint">mezzi punti con i tasti ± </span></div>
          <div class="vote" id="voteBtns">${[...Array(11).keys()].map((v) => `<button type="button" data-v="${v}" class="${evalDraft.vote !== null && Math.floor(evalDraft.vote) === v ? 'on' : ''}">${v}</button>`).join('')}</div>
          <div class="row"><button type="button" class="small secondary" id="voteMinus">−½</button><b id="voteVal" class="vote-val">${evalDraft.vote !== null ? num(evalDraft.vote, 1) : '–'}</b><button type="button" class="small secondary" id="votePlus">+½</button></div>
          <div class="lab-row mt"><label>Criteri</label><span class="hint">promemoria facoltativi</span></div>
          <div class="crit" id="critBox">${Object.entries(CRIT).map(([k, l]) => `<div><span>${l}</span><span class="dots" data-k="${k}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${(evalDraft.criteria[k] || 0) >= n ? 'on' : ''}" aria-label="${n}"></button>`).join('')}</span></div>`).join('')}</div>
          <div class="lab-row mt"><label for="evalComment">Commento per il gruppo</label></div>
          <textarea id="evalComment" maxlength="1500" placeholder="Punti di forza, cosa migliorare…">${esc(evalDraft.comment)}</textarea>
          <div class="final-box mt" id="finalBox"></div>
          <p class="row mt"><button type="button" id="evalSave">Salva giudizio</button>${dossier.evaluation ? '<button type="button" class="small danger" id="evalDel">Rimuovi</button>' : ''}</p>
          <div id="evalMsg"></div>
        </aside>
      </div>`;
    $$('#dossierView .bar i').forEach((i) => { i.style.width = Math.max(2, Number(i.dataset.w)) + '%'; });
    const updateFinal = () => {
      const v = evalDraft.vote;
      const fin = gameScore !== null && v !== null ? gameScore * (1 - dossier.weight) + v * 10 * dossier.weight : null;
      $('#finalBox').innerHTML = `<div class="pv-row"><span>Punteggio di gioco (${100 - w}%)</span><b>${gameScore !== null ? num(gameScore, 1) : '–'}</b></div>
        <div class="pv-row"><span>Tuo giudizio (${w}%)</span><b>${v !== null ? num(v * 10, 1) : '–'}</b></div>
        <div class="pv-row total"><span>Punteggio finale</span><b>${fin !== null ? num(fin, 1) : '–'}</b></div>`;
      $('#voteVal').textContent = v !== null ? num(v, 1) : '–';
      $$('#voteBtns button').forEach((b) => b.classList.toggle('on', v !== null && Math.floor(v) === Number(b.dataset.v)));
    };
    updateFinal();
    $('#dosBack').addEventListener('click', closeDossier);
    const nav = $('#dosRounds');
    if (nav) nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-r]'); if (!b) return; dossierRound = b.dataset.r === 'all' ? 'all' : Number(b.dataset.r); evalDraft.comment = $('#evalComment').value; renderDossier(list); });
    $('#voteBtns').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { evalDraft.vote = Number(b.dataset.v); updateFinal(); } });
    $('#voteMinus').addEventListener('click', () => { evalDraft.vote = Math.max(0, (evalDraft.vote ?? 5) - 0.5); updateFinal(); });
    $('#votePlus').addEventListener('click', () => { evalDraft.vote = Math.min(10, (evalDraft.vote ?? 5) + 0.5); updateFinal(); });
    $('#critBox').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]'); if (!b) return;
      const k = b.parentElement.dataset.k, n = Number(b.dataset.n);
      evalDraft.criteria[k] = evalDraft.criteria[k] === n ? 0 : n;
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= evalDraft.criteria[k]));
    });
    $('#evalSave').addEventListener('click', async () => {
      if (evalDraft.vote === null) return msg('#evalMsg', 'Scegli un voto da 0 a 10.');
      evalDraft.comment = $('#evalComment').value;
      try {
        await api('PUT', `/api/teacher/games/${currentId}/groups/${g.id}/evaluation`, evalDraft);
        dossier = await api('GET', `/api/teacher/games/${currentId}/groups/${g.id}/dossier`);
        renderDossier(list);
        msg('#evalMsg', 'Giudizio salvato.', 'ok');
        loadDetail().catch(() => {});
      } catch (err) { msg('#evalMsg', err.message); }
    });
    const del = $('#evalDel');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Rimuovere il giudizio di questo gruppo?')) return;
      await api('DELETE', `/api/teacher/games/${currentId}/groups/${g.id}/evaluation`).catch(() => {});
      openDossier(g.id); loadDetail().catch(() => {});
    });
  }

  function renderBoard() {
    const lb = d.leaderboard;
    if (!lb.rows.length) { $('#boardBox').innerHTML = '<h2>Classifica</h2><p class="muted">La classifica compare dopo il primo round calcolato.</p>'; return; }
    $('#boardBox').innerHTML = `<h2>Classifica dopo il round ${lb.round}</h2><table><thead><tr><th>#</th><th>Startup / gruppo</th>
      <th class="n">Punteggio</th><th class="n">Ricavi</th><th class="n">Utile round</th><th class="n">Utile cum.</th><th class="n">Cassa</th><th class="n">Brand</th><th class="n">Qualità</th><th class="n">Sostenib.</th><th class="n">Quota</th><th class="n">Magazzino</th></tr></thead><tbody>
      ${lb.rows.map((r) => `<tr><td><strong>${r.rank}</strong></td><td>${groupCell({ name: r.group_name, startup_name: r.startup_name, segment: r.segment, market: r.market })}</td>
        <td class="n"><strong>${num(r.score, 1)}</strong></td><td class="n">${eur(r.revenue)}</td><td class="n">${eur(r.profit)}</td><td class="n">${eur(r.cum_profit)}</td><td class="n">${eur(r.cash)}</td>
        <td class="n">${num(r.brand, 1)}</td><td class="n">${num(r.quality, 1)}</td><td class="n">${num(r.sustainability, 1)}</td><td class="n">${num(r.market_share, 1)}%</td><td class="n">${num(r.inventory)}</td></tr>`).join('')}
      </tbody></table>`;
  }

  async function loadResults() {
    if (!currentId) return;
    try {
      const [r, fin] = await Promise.all([api('GET', `/api/teacher/games/${currentId}/results`), api('GET', `/api/teacher/games/${currentId}/final`)]);
      const groups = [...new Set(r.rows.map((x) => x.group_name))];
      const rounds = [...new Set(r.rows.map((x) => x.round))];
      const done = fin.rows.filter((x) => x.vote !== null).length;
      const w = Math.round(fin.weight * 100);
      const finalHTML = fin.rows.length ? `<div class="panel"><div class="row"><div><h2>Classifica finale</h2>
          <p class="lead">Punteggio finale = ${100 - w}% risultati del gioco + ${w}% tuo giudizio sul ragionamento. Il peso si cambia nelle Impostazioni.</p></div><span class="spacer"></span>
          <span class="badge ${done === fin.rows.length ? 'ok' : 'warn'}">${done} di ${fin.rows.length} gruppi valutati</span></div>
        ${done < fin.rows.length ? '<div class="msg info">Gli studenti vedranno la classifica finale (con il tuo giudizio) solo quando avrai valutato tutti i gruppi e avviato il debriefing. Fino ad allora vedono la classifica del solo gioco.</div>' : ''}
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Startup / gruppo</th><th class="n">Punteggio di gioco</th><th class="n">Tuo voto</th><th class="n">Punteggio finale</th><th>Rispetto al solo gioco</th><th></th></tr></thead><tbody>
        ${fin.rows.map((x) => `<tr><td><strong>${x.finalRank}</strong></td><td>${groupCell({ name: x.groupName, startup_name: x.startupName, segment: x.segment, market: x.market })}</td>
          <td class="n">${num(x.gameScore, 1)} <small>(${x.gameRank}°)</small></td><td class="n">${x.vote !== null ? num(x.vote, 1) + ' / 10' : '<span class="badge muted">da valutare</span>'}</td>
          <td class="n"><strong>${x.finalScore !== null ? num(x.finalScore, 1) : '–'}</strong></td>
          <td>${x.vote === null ? '' : x.movement > 0 ? `<span class="badge ok">▲ ${x.movement} ${x.movement === 1 ? 'posizione' : 'posizioni'}</span>` : x.movement < 0 ? `<span class="badge err">▼ ${-x.movement} ${x.movement === -1 ? 'posizione' : 'posizioni'}</span>` : '<span class="badge muted">= invariata</span>'}</td>
          <td><button class="small ${x.vote === null ? '' : 'secondary'}" data-eval="${x.groupId}">${x.vote === null ? 'Valuta' : 'Modifica'}</button></td></tr>`).join('')}
        </tbody></table></div></div>` : '';
      $('#debriefBox').innerHTML = finalHTML + `
        <div class="panel"><div class="row"><h2>Risultati aggregati per round</h2><span class="spacer"></span><a class="btn secondary" href="/api/teacher/games/${currentId}/export.csv">Scarica CSV completo</a></div>
          ${r.aggregates.length ? `<div class="table-wrap"><table><thead><tr><th>Round</th><th class="n">Gruppi</th><th class="n">Ricavi totali</th><th class="n">Utile medio</th><th class="n">Prezzo medio</th><th class="n">Marketing medio</th><th class="n">Brand medio</th><th class="n">Sostenib. media</th></tr></thead><tbody>
          ${r.aggregates.map((a) => `<tr><td>${a.round}</td><td class="n">${a.groups}</td><td class="n">${eur(a.totalRevenue)}</td><td class="n">${eur(a.avgProfit)}</td><td class="n">${eur(a.avgPrice)}</td><td class="n">${eur(a.avgMarketing)}</td><td class="n">${num(a.avgBrand, 1)}</td><td class="n">${num(a.avgSustainability, 1)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Nessun round ancora calcolato.</p>'}
        </div>
        ${rounds.length ? `<div class="panel"><h2>Andamento del punteggio</h2><div class="table-wrap"><table><thead><tr><th>Gruppo</th>${rounds.map((n) => `<th class="n">R${n}</th>`).join('')}</tr></thead><tbody>
          ${groups.map((g) => `<tr><td>${esc(g)}</td>${rounds.map((n) => { const x = r.rows.find((y) => y.group_name === g && y.round === n); return `<td class="n">${x ? num(x.score, 1) + ` <small>(${x.rank}°)</small>` : '–'}</td>`; }).join('')}</tr>`).join('')}
          </tbody></table></div></div>
        <div class="panel"><h2>Decisioni e strategie dei gruppi</h2><p class="lead">Per lo studio completo apri la scheda del gruppo.</p><div class="table-wrap"><table><thead><tr><th>R</th><th>Gruppo</th><th class="n">Prezzo</th><th class="n">Prod.</th><th class="n">Venduti</th><th class="n">Mkt</th><th class="n">Design</th><th class="n">Sost.</th><th>Canale</th><th class="n">Utile</th><th>Strategia</th></tr></thead><tbody>
          ${r.rows.map((x) => `<tr><td>${x.round}</td><td>${esc(x.group_name)}</td><td class="n">${eur(x.decision && x.decision.price)}</td><td class="n">${num(x.decision && x.decision.production)}</td><td class="n">${num(x.units_sold)}</td>
            <td class="n">${eur(x.decision && x.decision.marketing)}</td><td class="n">${eur(x.decision && x.decision.design)}</td><td class="n">${eur(x.decision && x.decision.sustainability)}</td><td>${esc(x.decision && CH[x.decision.channel])}</td>
            <td class="n">${eur(x.profit)}</td><td><small>${esc(x.strategy || (x.decision && x.decision.notes) || '')}</small></td></tr>`).join('')}
          </tbody></table></div></div>` : ''}`;
    } catch (err) { $('#debriefBox').innerHTML = `<div class="msg err">${esc(err.message)}</div>`; }
  }

  $('#debriefBox').addEventListener('click', (e) => { const b = e.target.closest('button[data-eval]'); if (b) openDossier(Number(b.dataset.eval)); });

  // ---------- eventi ----------
  // Effetti degli eventi in linguaggio semplice: cursori in percentuale, convertiti nei moltiplicatori del motore
  const GREEN_LEVELS = [0, 0.15, 0.3, 0.5];
  const GREEN_LABEL = ['nessun cambiamento', 'un po\' di più', 'molto di più', 'moltissimo di più'];
  const EFFECTS = [
    { k: 'dm_EU', label: 'Domanda in Europa', min: -50, max: 50, step: 5, kind: 'pct' },
    { k: 'dm_US', label: 'Domanda negli Stati Uniti', min: -50, max: 50, step: 5, kind: 'pct' },
    { k: 'dm_ASIA', label: 'Domanda in Asia', min: -50, max: 50, step: 5, kind: 'pct' },
    { k: 'ds_premium', label: 'Domanda nel fashion premium', min: -50, max: 50, step: 5, kind: 'pct', help: 'Vale in tutti i mercati.' },
    { k: 'ds_luxury', label: 'Domanda nel lusso', min: -50, max: 50, step: 5, kind: 'pct', help: 'Vale in tutti i mercati.' },
    { k: 'cost', label: 'Costi di produzione', min: -30, max: 30, step: 2, kind: 'pct', help: 'Per tutti i gruppi (es. materie prime, trasporti).' },
    { k: 'tm_EU', label: 'Dazio per chi vende in Europa', min: -20, max: 50, step: 5, kind: 'pct', help: 'Aumenta il costo di ogni pezzo solo per chi vende lì.' },
    { k: 'tm_US', label: 'Dazio per chi vende negli Stati Uniti', min: -20, max: 50, step: 5, kind: 'pct' },
    { k: 'tm_ASIA', label: 'Dazio per chi vende in Asia', min: -20, max: 50, step: 5, kind: 'pct' },
    { k: 'shock', label: 'Penalità per chi è poco sostenibile', min: 0, max: 20, step: 1, kind: 'pts', help: 'Punti di brand persi dai gruppi con sostenibilità sotto 40 (scandali, nuove leggi green).' },
    { k: 'green', label: 'Attenzione dei clienti alla sostenibilità', min: 0, max: 3, step: 1, kind: 'green', help: 'Per questo round i clienti premiano di più i brand sostenibili.' },
  ];
  const fmtEff = (e, v) => {
    if (e.kind === 'green') return v ? GREEN_LABEL[v] : 'nessun effetto';
    if (!v) return 'nessun effetto';
    return e.kind === 'pts' ? `−${v} punti brand` : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
  };
  // effetti salvati → valori dei cursori
  function effectsToSliders(fx = {}) {
    const p = (m) => (m === undefined || m === null ? 0 : Math.round((m - 1) * 100));
    const v = {};
    for (const m of ['EU', 'US', 'ASIA']) { v['dm_' + m] = p(fx.demandByMarket && fx.demandByMarket[m]); v['tm_' + m] = Math.round(((fx.tariffByMarket && fx.tariffByMarket[m]) || 0) * 100); }
    for (const sg of ['premium', 'luxury']) v['ds_' + sg] = p(fx.demandBySegment && fx.demandBySegment[sg]);
    v.cost = p(fx.costMultiplier);
    v.shock = fx.lowSustainabilityBrandShock || 0;
    const g = fx.sustainabilityPreferenceDelta || 0;
    v.green = GREEN_LEVELS.reduce((best, lv, idx) => (Math.abs(lv - g) < Math.abs(GREEN_LEVELS[best] - g) ? idx : best), 0);
    return v;
  }
  // valori dei cursori → effetti per il server
  function slidersToEffects(v) {
    const fx = { demandByMarket: {}, demandBySegment: {}, tariffByMarket: {} };
    for (const m of ['EU', 'US', 'ASIA']) {
      if (v['dm_' + m]) fx.demandByMarket[m] = 1 + v['dm_' + m] / 100;
      if (v['tm_' + m]) fx.tariffByMarket[m] = v['tm_' + m] / 100;
    }
    for (const sg of ['premium', 'luxury']) if (v['ds_' + sg]) fx.demandBySegment[sg] = 1 + v['ds_' + sg] / 100;
    if (v.cost) fx.costMultiplier = 1 + v.cost / 100;
    if (v.shock) fx.lowSustainabilityBrandShock = v.shock;
    if (v.green) fx.sustainabilityPreferenceDelta = GREEN_LEVELS[v.green];
    return fx;
  }
  function describeEffects(fx) {
    const v = effectsToSliders(fx), out = [];
    for (const e of EFFECTS) if (v[e.k]) out.push(`${e.label.charAt(0).toLowerCase() + e.label.slice(1)} ${fmtEff(e, v[e.k])}`);
    return out.join(' · ') || 'nessun effetto';
  }
  function readSliders() {
    const v = {};
    for (const e of EFFECTS) v[e.k] = Number($('#eventForm')['fx_' + e.k].value) || 0;
    return v;
  }
  function buildEffectFields() {
    $('#effectFields').innerHTML = EFFECTS.map((e) => `<div class="field-h"><div class="lab-row"><label for="fx_${e.k}">${e.label}</label><span class="hint val" id="fxv_${e.k}">nessun effetto</span></div>
      <input type="range" class="range" id="fx_${e.k}" name="fx_${e.k}" min="${e.min}" max="${e.max}" step="${e.step}" value="0">${e.help ? `<div class="help">${e.help}</div>` : ''}</div>`).join('');
  }
  function updateEffectPreview() {
    const v = readSliders();
    for (const e of EFFECTS) {
      const el = $('#fxv_' + e.k);
      el.textContent = fmtEff(e, v[e.k]);
      el.className = 'hint val ' + (!v[e.k] ? '' : (e.kind === 'pct' && (e.k.startsWith('d') ? v[e.k] > 0 : v[e.k] < 0)) || e.kind === 'green' ? 'pos' : 'neg');
    }
    const lines = [];
    const word = (n) => (n > 0 ? 'in più' : 'in meno');
    for (const m of ['EU', 'US', 'ASIA']) if (v['dm_' + m]) lines.push(`In <b>${MKT[m]}</b> ci saranno il <b>${Math.abs(v['dm_' + m])}% di clienti ${word(v['dm_' + m])}</b>.`);
    for (const sg of ['premium', 'luxury']) if (v['ds_' + sg]) lines.push(`Nel <b>${SEG[sg].toLowerCase()}</b> ci saranno il <b>${Math.abs(v['ds_' + sg])}% di clienti ${word(v['ds_' + sg])}</b>, in tutti i mercati.`);
    if (v.cost) lines.push(`Produrre ogni pezzo costerà il <b>${Math.abs(v.cost)}% ${v.cost > 0 ? 'in più' : 'in meno'}</b> a tutti.`);
    for (const m of ['EU', 'US', 'ASIA']) if (v['tm_' + m]) lines.push(`Chi vende in <b>${MKT[m]}</b> ${v['tm_' + m] > 0 ? 'paga un dazio del' : 'risparmia il'} <b>${Math.abs(v['tm_' + m])}%</b> sul costo di ogni pezzo.`);
    if (v.shock) lines.push(`I gruppi con sostenibilità sotto 40 perdono <b>${v.shock} punti di brand</b>.`);
    if (v.green) lines.push(`I clienti premiano la sostenibilità <b>${GREEN_LABEL[v.green]}</b> del solito.`);
    $('#effectSummary').innerHTML = `<b>Cosa succederà con questo evento</b>${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : '<p class="help">Nessun effetto: muovi i cursori a sinistra.</p>'}`;
    // gruppi colpiti, calcolati sulle startup della sessione
    const sust = new Map(d.leaderboard.rows.map((r) => [r.group_id, r.sustainability]));
    const startS = (d.game.params.start || {}).sustainability ?? 30;
    const chips = d.groups.filter((g) => g.segment).map((g) => {
      const dem = (1 + (v['dm_' + g.market] || 0) / 100) * (1 + (v['ds_' + g.segment] || 0) / 100);
      const cost = (1 + v.cost / 100) * (1 + (v['tm_' + g.market] || 0) / 100);
      const parts = [];
      if (Math.abs(dem - 1) > 0.001) parts.push(`domanda ${dem > 1 ? '+' : '−'}${Math.round(Math.abs(dem - 1) * 100)}%`);
      if (Math.abs(cost - 1) > 0.001) parts.push(`costi ${cost > 1 ? '+' : '−'}${Math.round(Math.abs(cost - 1) * 100)}%`);
      if (v.shock && (sust.has(g.id) ? sust.get(g.id) : startS) < 40) parts.push(`−${v.shock} brand`);
      const bad = dem < 0.999 || cost > 1.001 || parts.some((p) => p.includes('brand'));
      const good = !bad && parts.length;
      return `<span class="chip ${bad ? 'r' : good ? 'g' : ''}">${esc(g.startup_name)} · ${parts.length ? parts.join(', ') : 'nessun effetto'}</span>`;
    });
    $('#effectGroups').innerHTML = chips.length ? chips.join('') : '<span class="help">Nessuna startup ancora configurata in questa sessione.</span>';
  }
  function resetEventForm() {
    const f = $('#eventForm');
    f.reset(); f.id.value = '';
    $('#eventFormTitle').textContent = 'Nuovo evento';
    updateEffectPreview();
  }

  function renderEvents() {
    if (eventsFor !== d.game.id) { buildEffectFields(); eventsFor = d.game.id; }
    updateEffectPreview();
    const usedIds = new Set(d.rounds.flatMap((r) => r.events.map((e) => e.id)));
    $('#eventsBox').innerHTML = `<table><thead><tr><th>Evento</th><th>Effetti</th><th></th></tr></thead><tbody>
      ${d.events.map((e) => `<tr><td><strong>${esc(e.title)}</strong>${e.custom ? ' <span class="badge info">tuo</span>' : ''}<br><small class="muted">${esc(e.description)}</small></td>
        <td><small>${esc(describeEffects(e.effects))}</small></td><td><div class="controls"><button class="small secondary" data-edit="${e.id}">Modifica</button>
        ${usedIds.has(e.id) ? '' : `<button class="small danger" data-delev="${e.id}">Elimina</button>`}</div></td></tr>`).join('')}</tbody></table>`;
  }
  $('#eventsBox').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) {
      const ev = d.events.find((x) => x.id === Number(b.dataset.edit));
      const f = $('#eventForm');
      f.id.value = ev.id; f.title.value = ev.title; f.description.value = ev.description;
      const v = effectsToSliders(ev.effects);
      for (const k of Object.keys(v)) if (f['fx_' + k]) f['fx_' + k].value = v[k];
      $('#eventFormTitle').textContent = 'Modifica evento';
      updateEffectPreview();
      f.scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.delev) {
      if (!confirm('Eliminare questo evento dal catalogo?')) return;
      try { await api('DELETE', `/api/teacher/games/${currentId}/events/${b.dataset.delev}`); roundKey = null; await loadDetail(); }
      catch (err) { msg('#eventMsg', err.message); }
    }
  });
  $('#eventForm').addEventListener('input', updateEffectPreview);
  $('#eventCancel').addEventListener('click', resetEventForm);
  $('#eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { title: f.title.value, description: f.description.value, effects: slidersToEffects(readSliders()) };
    try {
      if (f.id.value) await api('PUT', `/api/teacher/games/${currentId}/events/${f.id.value}`, body);
      else await api('POST', `/api/teacher/games/${currentId}/events`, body);
      msg('#eventMsg', 'Evento salvato.', 'ok');
      resetEventForm();
      roundKey = null;
      await loadDetail();
    } catch (err) { msg('#eventMsg', err.message); }
  });

  // ---------- impostazioni ----------
  const WEIGHTS = { cumProfit: 'Guadagni totali', brand: 'Forza del brand', marketShare: 'Quota di mercato', sustainability: 'Sostenibilità', cash: 'Cassa disponibile' };
  const WCOL = { cumProfit: '#0A0B0F', brand: '#0B1A3A', marketShare: '#2F6BFF', sustainability: '#5B8CFF', cash: '#BFD4FF' };
  const LEVEL = (opts, cur, fmt) => {
    const has = opts.some(([v]) => Math.abs(v - cur) < 1e-9);
    return opts.map(([v, l]) => `<option value="${v}" ${Math.abs(v - cur) < 1e-9 ? 'selected' : ''}>${l}</option>`).join('') + (has ? '' : `<option value="${cur}" selected>personalizzato (${fmt ? fmt(cur) : cur})</option>`);
  };
  let setPreset = 'standard';
  const ADV = [
    { k: 'startingCash', label: 'Cassa iniziale (€)', help: 'I soldi con cui ogni startup parte.', type: 'num', step: 10000 },
    { k: 'fixedCostPerRound', label: 'Spese fisse a round (€)', help: 'Affitto, stipendi…: si pagano sempre, anche senza vendere.', type: 'num', step: 1000 },
    { k: 'outsideOption', label: 'Clienti che non comprano', help: 'Più è alto, più clienti restano senza comprare: il mercato è più difficile.', type: 'sel', opts: [[1.0, 'Pochi'], [1.5, 'Medi'], [2.2, 'Molti']] },
    { k: 'sustainabilityPreference', label: 'Attenzione green dei clienti', help: 'Quanto i clienti premiano i brand sostenibili.', type: 'sel', opts: [[0.15, 'Bassa'], [0.3, 'Media'], [0.6, 'Alta']] },
    { k: 'seg.luxury.refPrice', label: 'Lusso: prezzo tipico (€)', help: 'Il prezzo "normale" di un prodotto luxury. Lo vedono gli studenti come riferimento.', type: 'num', step: 10 },
    { k: 'seg.premium.refPrice', label: 'Premium: prezzo tipico (€)', help: 'Il prezzo "normale" di un prodotto fashion premium.', type: 'num', step: 5 },
    { k: 'seg.luxury.baseDemand', label: 'Lusso: clienti a round', help: 'Pezzi che comprerebbe un mercato di dimensione normale (Europa).', type: 'num', step: 100 },
    { k: 'seg.premium.baseDemand', label: 'Premium: clienti a round', help: 'Pezzi che comprerebbe un mercato di dimensione normale (Europa).', type: 'num', step: 500 },
    { k: 'seg.luxury.unitCost', label: 'Lusso: costo di un pezzo (€)', help: 'Costo di produzione di base, prima di qualità ed eventi.', type: 'num', step: 5 },
    { k: 'seg.premium.unitCost', label: 'Premium: costo di un pezzo (€)', help: 'Costo di produzione di base, prima di qualità ed eventi.', type: 'num', step: 1 },
    { k: 'seg.luxury.elasticity', label: 'Lusso: sensibilità al prezzo', help: 'Quanti clienti si perdono alzando il prezzo.', type: 'sel', opts: [[0.4, 'Bassa'], [0.5, 'Media'], [0.65, 'Alta']] },
    { k: 'seg.premium.elasticity', label: 'Premium: sensibilità al prezzo', help: 'Quanti clienti si perdono alzando il prezzo.', type: 'sel', opts: [[1.3, 'Bassa'], [1.5, 'Media'], [1.8, 'Alta']] },
    { k: 'mkt.EU.demandWeight', label: 'Grandezza mercato Europa', help: '1 = dimensione normale; 1,2 = 20% di clienti in più.', type: 'num', step: 0.05 },
    { k: 'mkt.US.demandWeight', label: 'Grandezza mercato Stati Uniti', help: '1 = dimensione normale.', type: 'num', step: 0.05 },
    { k: 'mkt.ASIA.demandWeight', label: 'Grandezza mercato Asia', help: '1 = dimensione normale.', type: 'num', step: 0.05 },
    { k: 'holdingCostRate', label: 'Costo del magazzino (%)', help: 'Quanto costa tenere un pezzo invenduto, in % del suo costo di produzione.', type: 'pct', step: 1 },
  ];
  const getP = (p, path) => path.split('.').reduce((o, k) => (o ? o[k === 'seg' ? 'segments' : k === 'mkt' ? 'markets' : k] : undefined), p);
  function fillSettings() {
    settingsFor = d.game.id;
    const f = $('#settingsForm'), g = d.game, p = g.params;
    f.name.value = g.name; f.numSessions.value = g.numSessions; f.sessionMinutes.value = g.sessionMinutes; f.numRounds.value = g.numRounds;
    f.leaderboardPublic.checked = g.leaderboardPublic;
    setPreset = p.preset || 'standard';
    $('#setPresets').innerHTML = presetHTML(setPreset);
    const wsum = Object.values(p.scoreWeights).reduce((a, b) => a + b, 0) || 1;
    $('#weightFields').innerHTML = Object.entries(WEIGHTS).map(([k, l]) => `<div class="field-h"><div class="lab-row"><label>${l}</label><span class="hint">%</span></div><input name="w_${k}" type="number" min="0" max="100" step="5" value="${Math.round((p.scoreWeights[k] / wsum) * 100)}"></div>`).join('');
    f.judgmentWeight.value = Math.round((p.judgmentWeight ?? 0.4) * 100);
    $('#advFields').innerHTML = ADV.map((a) => {
      const cur = getP(p, a.k);
      const input = a.type === 'sel' ? `<select name="adv_${a.k}">${LEVEL(a.opts, cur)}</select>`
        : `<input name="adv_${a.k}" type="number" step="${a.step}" value="${a.type === 'pct' ? Math.round(cur * 100) : cur}">`;
      return `<div class="mini"><div class="lab-row"><label>${a.label}</label></div>${input}<div class="help">${a.help}</div></div>`;
    }).join('');
    updateSettingsUI();
  }
  function updateSettingsUI() {
    const f = $('#settingsForm');
    const vals = Object.keys(WEIGHTS).map((k) => [k, Math.max(0, Number(f['w_' + k].value) || 0)]);
    const tot = vals.reduce((a, [, v]) => a + v, 0) || 1;
    $('#weightsBar').innerHTML = vals.map(([k, v]) => `<i data-w="${(v / tot) * 100}" data-c="${k}"></i>`).join('');
    $$('#weightsBar i').forEach((i) => { i.style.width = i.dataset.w + '%'; i.style.background = WCOL[i.dataset.c]; });
    const w = Number(f.judgmentWeight.value);
    $('#setWeightVal').textContent = w + '%';
    $('#setWeightHelp').innerHTML = weightHelp(w);
  }
  $('#settingsForm').addEventListener('input', (e) => {
    if (e.target.name && e.target.name.startsWith('adv_') && setPreset !== 'personalizzato') { setPreset = 'personalizzato'; $('#setPresets').innerHTML = presetHTML(setPreset); }
    updateSettingsUI();
  });
  $('#setPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    setPreset = b.dataset.preset;
    const pr = PRESETS[setPreset], f = $('#settingsForm');
    const put = (k, v) => { const el = f['adv_' + k]; if (!el) return; if (el.tagName === 'SELECT' && ![...el.options].some((o) => Number(o.value) === v)) el.insertAdjacentHTML('beforeend', `<option value="${v}">${v}</option>`); el.value = v; };
    put('startingCash', pr.startingCash); put('fixedCostPerRound', pr.fixedCostPerRound); put('outsideOption', pr.outsideOption);
    for (const sg of ['premium', 'luxury']) { put(`seg.${sg}.baseDemand`, pr.segments[sg].baseDemand); put(`seg.${sg}.elasticity`, pr.segments[sg].elasticity); }
    $('#setPresets').innerHTML = presetHTML(setPreset);
  });
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const params = { preset: setPreset, segments: { premium: {}, luxury: {} }, markets: { EU: {}, US: {}, ASIA: {} }, scoreWeights: {} };
    for (const a of ADV) {
      let v = f['adv_' + a.k].value;
      if (a.type === 'pct') v = Number(v) / 100;
      const parts = a.k.split('.');
      if (parts[0] === 'seg') params.segments[parts[1]][parts[2]] = v;
      else if (parts[0] === 'mkt') params.markets[parts[1]][parts[2]] = v;
      else params[a.k] = v;
    }
    for (const k of Object.keys(WEIGHTS)) params.scoreWeights[k] = f['w_' + k].value;
    params.judgmentWeight = Number(f.judgmentWeight.value) / 100;
    try {
      await api('PATCH', `/api/teacher/games/${currentId}`, {
        name: f.name.value, numSessions: f.numSessions.value, sessionMinutes: f.sessionMinutes.value, numRounds: f.numRounds.value,
        leaderboardPublic: f.leaderboardPublic.checked, params,
      });
      msg('#settingsMsg', 'Impostazioni salvate.', 'ok');
      settingsFor = null; roundKey = null;
      await loadDetail(); await loadGames();
    } catch (err) { msg('#settingsMsg', err.message); }
  });

  loadGames().then(() => { if (games.length) select(games[0].id); });
})();
