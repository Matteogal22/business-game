// Dashboard docente
(function () {
  const { api, esc, eur, num, $, $$, badge, codeBadge, SEG, MKT, CH, makeTimer, ringHTML, clock } = window.BG;
  let games = [];
  let currentId = null;
  let d = null;            // dettaglio partita corrente
  let roundKey = null;
  let settingsFor = null;
  let poll = null;
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
  $('#newGameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('POST', '/api/teacher/games', {
        name: f.name.value, numSessions: f.numSessions.value, sessionMinutes: f.sessionMinutes.value,
        numRounds: f.numRounds.value, leaderboardPublic: f.leaderboardPublic.checked,
      });
      f.name.value = '';
      msg('#newGameMsg', 'Sessione creata.', 'ok');
      await loadGames();
      select(r.id);
    } catch (err) { msg('#newGameMsg', err.message); }
  });

  async function select(id) {
    currentId = id; roundKey = null; settingsFor = null;
    msg('#actionMsg', '');
    $$('#gameList button').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === id));
    await loadDetail();
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
        <div class="table-wrap"><table><thead><tr><th>Gruppo</th><th class="n">Prezzo</th><th class="n">Produzione</th><th class="n">Marketing</th><th class="n">Design</th><th class="n">Sostenib.</th><th>Canale</th><th>Motivazione</th></tr></thead><tbody>
        ${withStartup.map((g) => { const x = sent.get(g.id); const dd = x && x.decision; return `<tr><td>${groupCell(g)}</td>
          ${dd ? `<td class="n">${eur(dd.price)}</td><td class="n">${num(dd.production)}</td><td class="n">${eur(dd.marketing)}</td><td class="n">${eur(dd.design)}</td><td class="n">${eur(dd.sustainability)}</td><td>${esc(CH[dd.channel])}</td><td><small>${esc(dd.notes)}</small></td>`
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
    const sent = new Set(d.currentDecisions.map((x) => x.groupId));
    $('#groupsBox').innerHTML = `<table><thead><tr><th>Startup / gruppo</th><th>Componenti</th><th>Categoria</th><th>Posizionamento</th><th class="n">Dispositivi</th>${open ? '<th>Round</th>' : ''}<th></th></tr></thead><tbody>
      ${d.groups.map((g) => `<tr><td>${groupCell(g)}</td><td><small>${esc(g.members.join(', ')) || '–'}</small></td>
        <td>${esc(g.category || '–')}</td><td><small>${esc(g.positioning)}</small></td><td class="n">${g.devices}</td>
        ${open ? `<td>${sent.has(g.id) ? '<span class="badge ok">Inviate</span>' : '<span class="badge warn">In attesa</span>'}</td>` : ''}
        <td><div class="controls"><button class="small secondary" data-pin="${g.id}">Nuovo PIN</button><button class="small secondary" data-logout="${g.id}">Scollega</button><button class="small danger" data-del="${g.id}">Elimina</button></div></td></tr>`).join('')}
      </tbody></table>`;
  }
  $('#groupsBox').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
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
      const r = await api('GET', `/api/teacher/games/${currentId}/results`);
      const groups = [...new Set(r.rows.map((x) => x.group_name))];
      const rounds = [...new Set(r.rows.map((x) => x.round))];
      $('#debriefBox').innerHTML = `
        <div class="panel"><div class="row"><h2>Risultati aggregati per round</h2><span class="spacer"></span><a class="btn secondary" href="/api/teacher/games/${currentId}/export.csv">Scarica CSV completo</a></div>
          ${r.aggregates.length ? `<div class="table-wrap"><table><thead><tr><th>Round</th><th class="n">Gruppi</th><th class="n">Ricavi totali</th><th class="n">Utile medio</th><th class="n">Prezzo medio</th><th class="n">Marketing medio</th><th class="n">Brand medio</th><th class="n">Sostenib. media</th></tr></thead><tbody>
          ${r.aggregates.map((a) => `<tr><td>${a.round}</td><td class="n">${a.groups}</td><td class="n">${eur(a.totalRevenue)}</td><td class="n">${eur(a.avgProfit)}</td><td class="n">${eur(a.avgPrice)}</td><td class="n">${eur(a.avgMarketing)}</td><td class="n">${num(a.avgBrand, 1)}</td><td class="n">${num(a.avgSustainability, 1)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Nessun round ancora calcolato.</p>'}
        </div>
        ${rounds.length ? `<div class="panel"><h2>Andamento del punteggio</h2><div class="table-wrap"><table><thead><tr><th>Gruppo</th>${rounds.map((n) => `<th class="n">R${n}</th>`).join('')}</tr></thead><tbody>
          ${groups.map((g) => `<tr><td>${esc(g)}</td>${rounds.map((n) => { const x = r.rows.find((y) => y.group_name === g && y.round === n); return `<td class="n">${x ? num(x.score, 1) + ` <small>(${x.rank}°)</small>` : '–'}</td>`; }).join('')}</tr>`).join('')}
          </tbody></table></div></div>
        <div class="panel"><h2>Decisioni e motivazioni dei gruppi</h2><div class="table-wrap"><table><thead><tr><th>R</th><th>Gruppo</th><th class="n">Prezzo</th><th class="n">Prod.</th><th class="n">Venduti</th><th class="n">Mkt</th><th class="n">Design</th><th class="n">Sost.</th><th>Canale</th><th class="n">Utile</th><th>Motivazione</th></tr></thead><tbody>
          ${r.rows.map((x) => `<tr><td>${x.round}</td><td>${esc(x.group_name)}</td><td class="n">${eur(x.decision && x.decision.price)}</td><td class="n">${num(x.decision && x.decision.production)}</td><td class="n">${num(x.units_sold)}</td>
            <td class="n">${eur(x.decision && x.decision.marketing)}</td><td class="n">${eur(x.decision && x.decision.design)}</td><td class="n">${eur(x.decision && x.decision.sustainability)}</td><td>${esc(x.decision && CH[x.decision.channel])}</td>
            <td class="n">${eur(x.profit)}</td><td><small>${esc(x.decision && x.decision.notes)}</small></td></tr>`).join('')}
          </tbody></table></div></div>` : ''}`;
    } catch (err) { $('#debriefBox').innerHTML = `<div class="msg err">${esc(err.message)}</div>`; }
  }

  // ---------- eventi ----------
  function renderEvents() {
    const usedIds = new Set(d.rounds.flatMap((r) => r.events.map((e) => e.id)));
    const fx = (e) => {
      const p = [];
      const f = e.effects || {};
      for (const [k, v] of Object.entries(f.demandByMarket || {})) p.push(`domanda ${MKT[k]} ×${v}`);
      for (const [k, v] of Object.entries(f.demandBySegment || {})) p.push(`domanda ${SEG[k]} ×${v}`);
      for (const [k, v] of Object.entries(f.tariffByMarket || {})) p.push(`dazio ${MKT[k]} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
      if (f.costMultiplier) p.push(`costi ×${f.costMultiplier}`);
      if (f.lowSustainabilityBrandShock) p.push(`−${f.lowSustainabilityBrandShock} brand a chi è poco sostenibile`);
      if (f.sustainabilityPreferenceDelta) p.push(`sensibilità green +${f.sustainabilityPreferenceDelta}`);
      return p.join(' · ') || 'nessun effetto';
    };
    $('#eventsBox').innerHTML = `<table><thead><tr><th>Evento</th><th>Effetti</th><th></th></tr></thead><tbody>
      ${d.events.map((e) => `<tr><td><strong>${esc(e.title)}</strong>${e.custom ? ' <span class="badge info">personalizzato</span>' : ''}<br><small class="muted">${esc(e.description)}</small></td>
        <td><small>${esc(fx(e))}</small></td><td><div class="controls"><button class="small secondary" data-edit="${e.id}">Modifica</button>
        ${usedIds.has(e.id) ? '' : `<button class="small danger" data-delev="${e.id}">Elimina</button>`}</div></td></tr>`).join('')}</tbody></table>`;
  }
  $('#eventsBox').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) {
      const ev = d.events.find((x) => x.id === Number(b.dataset.edit));
      const f = $('#eventForm'); const fx = ev.effects || {};
      f.reset();
      f.id.value = ev.id; f.title.value = ev.title; f.description.value = ev.description;
      for (const m of ['EU', 'US', 'ASIA']) {
        f['dm_' + m].value = fx.demandByMarket && fx.demandByMarket[m] != null ? fx.demandByMarket[m] : '';
        f['tm_' + m].value = fx.tariffByMarket && fx.tariffByMarket[m] != null ? Math.round(fx.tariffByMarket[m] * 100) : '';
      }
      for (const s of ['premium', 'luxury']) f['ds_' + s].value = fx.demandBySegment && fx.demandBySegment[s] != null ? fx.demandBySegment[s] : '';
      f.costMultiplier.value = fx.costMultiplier ?? '';
      f.lowSustainabilityBrandShock.value = fx.lowSustainabilityBrandShock ?? '';
      f.sustainabilityPreferenceDelta.value = fx.sustainabilityPreferenceDelta ?? '';
      $('#eventFormTitle').textContent = 'Modifica evento';
      f.scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.delev) {
      if (!confirm('Eliminare questo evento dal catalogo?')) return;
      try { await api('DELETE', `/api/teacher/games/${currentId}/events/${b.dataset.delev}`); roundKey = null; await loadDetail(); }
      catch (err) { msg('#eventMsg', err.message); }
    }
  });
  $('#eventCancel').addEventListener('click', () => { $('#eventForm').reset(); $('#eventForm').id.value = ''; $('#eventFormTitle').textContent = 'Nuovo evento'; });
  $('#eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = (n) => (f[n].value === '' ? undefined : Number(f[n].value));
    const pct = (n) => (f[n].value === '' ? undefined : Number(f[n].value) / 100);
    const body = {
      title: f.title.value, description: f.description.value,
      effects: {
        demandByMarket: { EU: v('dm_EU'), US: v('dm_US'), ASIA: v('dm_ASIA') },
        demandBySegment: { premium: v('ds_premium'), luxury: v('ds_luxury') },
        tariffByMarket: { EU: pct('tm_EU'), US: pct('tm_US'), ASIA: pct('tm_ASIA') },
        costMultiplier: v('costMultiplier'), lowSustainabilityBrandShock: v('lowSustainabilityBrandShock'),
        sustainabilityPreferenceDelta: v('sustainabilityPreferenceDelta'),
      },
    };
    try {
      if (f.id.value) await api('PUT', `/api/teacher/games/${currentId}/events/${f.id.value}`, body);
      else await api('POST', `/api/teacher/games/${currentId}/events`, body);
      msg('#eventMsg', 'Evento salvato.', 'ok');
      f.reset(); f.id.value = ''; $('#eventFormTitle').textContent = 'Nuovo evento';
      roundKey = null;
      await loadDetail();
    } catch (err) { msg('#eventMsg', err.message); }
  });

  // ---------- impostazioni ----------
  function fillSettings() {
    settingsFor = d.game.id;
    const f = $('#settingsForm'), g = d.game, p = g.params;
    f.name.value = g.name; f.numSessions.value = g.numSessions; f.sessionMinutes.value = g.sessionMinutes; f.numRounds.value = g.numRounds;
    f.leaderboardPublic.checked = g.leaderboardPublic;
    for (const k of ['startingCash', 'fixedCostPerRound', 'outsideOption', 'sustainabilityPreference', 'holdingCostRate']) f['p_' + k].value = p[k];
    $('#segFields').innerHTML = Object.entries(p.segments).map(([k, s]) => `
      <div><label>${esc(s.label)}: prezzo di riferimento (€)</label><input name="s_${k}_refPrice" type="number" value="${s.refPrice}"></div>
      <div><label>${esc(s.label)}: elasticità al prezzo</label><input name="s_${k}_elasticity" type="number" step="0.05" value="${s.elasticity}"></div>
      <div><label>${esc(s.label)}: domanda base (pezzi/round)</label><input name="s_${k}_baseDemand" type="number" value="${s.baseDemand}"></div>
      <div><label>${esc(s.label)}: costo unitario base (€)</label><input name="s_${k}_unitCost" type="number" value="${s.unitCost}"></div>`).join('');
    for (const m of ['EU', 'US', 'ASIA']) f['m_' + m].value = p.markets[m].demandWeight;
    for (const k of Object.keys(p.scoreWeights)) f['w_' + k].value = p.scoreWeights[k];
  }
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const params = { segments: {}, markets: {}, scoreWeights: {} };
    for (const k of ['startingCash', 'fixedCostPerRound', 'outsideOption', 'sustainabilityPreference', 'holdingCostRate']) params[k] = f['p_' + k].value;
    for (const s of ['premium', 'luxury']) {
      params.segments[s] = {};
      for (const k of ['refPrice', 'elasticity', 'baseDemand', 'unitCost']) params.segments[s][k] = f[`s_${s}_${k}`].value;
    }
    for (const m of ['EU', 'US', 'ASIA']) params.markets[m] = { demandWeight: f['m_' + m].value };
    for (const k of ['cumProfit', 'brand', 'marketShare', 'sustainability', 'cash']) params.scoreWeights[k] = f['w_' + k].value;
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
