// Area studenti
(function () {
  const { api, esc, eur, num, $, $$, badge, SEG, MKT, CH, makeTimer, ringHTML } = window.BG;
  let data = null;
  let formKey = null;
  let pollTimer = null;
  let checkedCode = null;
  $('#sRing').innerHTML = ringHTML();
  const timer = makeTimer($('#sRing'));

  const show = (id) => {
    for (const s of ['join', 'pinShow', 'game']) $('#' + s).classList.toggle('hidden', s !== id);
    document.body.classList.toggle('has-tabbar', id === 'game');
    if (id === 'join') setTimeout(() => $('#code').focus(), 50);
  };
  const msg = (el, text, kind = 'err') => { $(el).innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ''; };

  // ---------- ingresso ----------
  $('#codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg('#joinMsg', '');
    try {
      const r = await api('POST', '/api/student/check-code', { code: $('#code').value });
      checkedCode = $('#code').value;
      $('#codeForm').classList.add('hidden');
      $('#codeInfo').innerHTML = `<div class="msg info"><strong>${esc(r.gameName)}</strong> · ${esc(r.gameStatusLabel)}${r.codeStatus === 'expired' ? ' (codice scaduto: possono rientrare solo i gruppi già registrati)' : ''}</div>`;
      $('#groupForm').classList.remove('hidden');
      $('#groupName').focus();
    } catch (err) {
      $('#codeInfo').innerHTML = '';
      $('#groupForm').classList.add('hidden');
      msg('#joinMsg', err.message);
    }
  });

  $('#groupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg('#joinMsg', '');
    try {
      const r = await api('POST', '/api/student/join', {
        code: checkedCode, groupName: $('#groupName').value, members: $('#members').value, pin: $('#pin').value || undefined,
      });
      if (r.pin) { $('#pinValue').textContent = r.pin; show('pinShow'); }
      else start();
    } catch (err) {
      if (err.data && err.data.needPin) $('#pinWrap').classList.remove('hidden');
      msg('#joinMsg', err.message);
    }
  });
  $('#pinOk').addEventListener('click', start);

  $('#leaveBtn').addEventListener('click', async () => {
    if (!confirm('Uscire da questo dispositivo? Per rientrare servirà il codice e il PIN del gruppo.')) return;
    await api('POST', '/api/student/leave').catch(() => {});
    location.reload();
  });

  // ---------- tab ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('section[data-panel]').forEach((s) => s.classList.toggle('hidden', s.dataset.panel !== b.dataset.tab));
  });

  // ---------- gioco ----------
  async function start() {
    try {
      await refresh();
      show('game');
      clearInterval(pollTimer);
      pollTimer = setInterval(() => refresh().catch(() => {}), 5000);
    } catch (err) {
      show('join');
      if (err.status === 403) msg('#joinMsg', err.message);
    }
  }

  async function refresh() {
    try {
      data = await api('GET', '/api/student/state');
    } catch (err) {
      if (err.status === 401 || err.status === 403) { clearInterval(pollTimer); show('join'); msg('#joinMsg', err.message); }
      throw err;
    }
    render();
  }

  function render() {
    const s = data.state;
    const last = data.history[data.history.length - 1];
    $('#whoami').textContent = data.group.name;
    $('#sGame').textContent = data.gameName;
    $('#sGroup').textContent = data.startup ? data.startup.name : data.group.name;
    $('#sSub').textContent = data.startup ? `Gruppo ${data.group.name} · ${SEG[data.startup.segment]} · ${MKT[data.startup.market]}` : `Gruppo ${data.group.name}`;
    $('#sStatus').innerHTML = badge(s.status);
    $('#sSession').innerHTML = `${s.currentSession || '–'} <small>/ ${s.numSessions}</small>`;
    $('#sRound').innerHTML = `${s.currentRound} <small>/ ${s.numRounds}</small>`;
    $('#sCash').textContent = eur(last ? last.cash : data.market.startingCash);
    $('#sRank').textContent = last ? last.rank + '°' : '–';
    timer.set(s);

    const notices = [];
    if (data.codeStatus === 'expired') notices.push(['info', 'Il codice di questa sessione è scaduto: puoi consultare i risultati ma non inviare decisioni.']);
    if (s.status === 'paused') notices.push(['warn', 'Il docente ha messo in pausa la sessione. Le decisioni sono temporaneamente bloccate.']);
    if (s.status === 'session_closed') notices.push(['info', `La sessione d'aula ${s.currentSession} è chiusa. Lo stato della partita è salvato: si riprende alla prossima sessione.`]);
    if (s.status === 'setup') notices.push(['info', 'La partita non è ancora iniziata. Intanto configurate la vostra startup.']);
    if (s.status === 'debrief') notices.push(['info', 'Siamo nella fase di debriefing: consultate risultati e classifica finale.']);
    if (s.status === 'ended') notices.push(['info', 'La partita è terminata.']);
    if (!data.startup) notices.push(['warn', 'Prima di decidere dovete creare la vostra startup (scheda "La nostra startup").']);
    $('#gameMsg').innerHTML = notices.map(([k, t]) => `<div class="msg ${k}">${esc(t)}</div>`).join('');

    renderStartup();
    renderRound();
    renderResults();
    renderBoard();
    renderMarket();
  }

  // ---------- startup ----------
  let startupFilled = false;
  function renderStartup() {
    const f = $('#startupForm');
    const locked = data.startupLocked;
    $('#startupHint').textContent = locked
      ? 'Segmento e mercato sono bloccati dopo il primo round calcolato. Nome, categoria, posizionamento e valori restano modificabili.'
      : 'Scegliete con cura segmento e mercato: dopo il primo round non si potranno più cambiare.';
    f.segment.disabled = locked; f.market.disabled = locked;
    if (!startupFilled && data.startup) {
      for (const k of ['name', 'segment', 'category', 'market', 'positioning', 'values_text']) f[k].value = data.startup[k] || '';
      startupFilled = true;
    }
    const closed = ['debrief', 'ended'].includes(data.state.status) || data.codeStatus !== 'active';
    $$('input, select, textarea, button', f).forEach((el) => { if (closed) el.disabled = true; });
  }
  $('#startupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = Object.fromEntries(['name', 'segment', 'category', 'market', 'positioning', 'values_text'].map((k) => [k, f[k].value]));
    try {
      await api('PUT', '/api/student/startup', body);
      msg('#startupMsg', 'Startup salvata.', 'ok');
      formKey = null; // ridisegna il form decisioni (dipende dal segmento)
      await refresh();
    } catch (err) { msg('#startupMsg', err.message); }
  });

  // ---------- round e decisioni ----------
  function renderRound() {
    const s = data.state;
    const r = data.openRound;
    const canSubmit = !!(r && s.status === 'running' && data.startup && data.codeStatus === 'active');
    const key = [r ? r.number : 0, canSubmit, data.startup ? data.startup.segment : '-'].join('|');
    const evThis = r ? (data.events.find((e) => e.round === r.number) || { events: [] }).events : [];

    if (key === formKey) { updateSaved(); return; }
    formKey = key;

    if (!r) {
      const last = data.history[data.history.length - 1];
      $('#roundPanel').innerHTML = `<div class="panel"><h2>Nessun round aperto</h2>
        <p class="muted">${s.currentRound ? `Il round ${s.currentRound} è stato chiuso e calcolato.` : 'Il docente non ha ancora aperto il primo round.'}
        La pagina si aggiorna automaticamente.</p>
        ${last ? `<p>Ultimo risultato: utile ${eur(last.profit)}, posizione <strong>${last.rank}</strong>. Vedi la scheda "Risultati".</p>` : ''}</div>`;
      return;
    }

    const seg = data.startup ? data.market.segments[data.startup.segment] : null;
    const prevDec = r.decision || (data.history.length ? data.history[data.history.length - 1].decision : null);
    const d = prevDec || (seg ? { price: seg.refPrice, production: data.startup.segment === 'luxury' ? 400 : 2000, marketing: 20000, design: 15000, sustainability: 10000, channel: 'ecommerce', notes: '' } : {});
    const last = data.history[data.history.length - 1];
    const cash = last ? last.cash : data.market.startingCash;
    const inventory = last ? last.inventory : 0;

    $('#roundPanel').innerHTML = `
      <div class="panel">
        <h2>Round ${r.number}</h2>
        <p class="lead">${evThis.length ? 'Eventi geopolitici annunciati per questo round:' : 'Nessun evento particolare annunciato per questo round.'}</p>
        ${evThis.map((e) => `<div class="event"><div><strong>${esc(e.title)}</strong>${esc(e.description)}</div></div>`).join('')}
      </div>
      <div class="panel">
        <h2>Decisioni del gruppo</h2>
        ${!canSubmit ? '<div class="msg warn">Le decisioni non possono essere inviate in questo momento.</div>' : ''}
        <div class="grid3">
          <div class="kpi"><div class="label">Cassa disponibile</div><div class="value">${eur(cash)}</div></div>
          <div class="kpi"><div class="label">Magazzino iniziale</div><div class="value">${num(inventory)} pz</div></div>
          ${seg ? `<div class="kpi"><div class="label">Prezzo di riferimento ${esc(seg.label)}</div><div class="value">${eur(seg.refPrice)}</div></div>
          <div class="kpi"><div class="label">Costo unitario base</div><div class="value">${eur(seg.unitCost)}</div></div>` : ''}
        </div>
        <form id="decisionForm">
          <div class="grid2">
            <div><label>Prezzo di vendita (€)</label><input name="price" type="number" min="10" step="1" value="${esc(d.price)}" required></div>
            <div><label>Quantità prodotta (pezzi)</label><input name="production" type="number" min="0" step="1" value="${esc(d.production)}" required></div>
            <div><label>Investimento marketing (€)</label><input name="marketing" type="number" min="0" step="1000" value="${esc(d.marketing)}" required></div>
            <div><label>Investimento design / R&amp;D (€)</label><input name="design" type="number" min="0" step="1000" value="${esc(d.design)}" required></div>
            <div><label>Investimento sostenibilità (€)</label><input name="sustainability" type="number" min="0" step="1000" value="${esc(d.sustainability)}" required></div>
            <div><label>Canale distributivo</label><select name="channel">
              ${Object.entries(data.market.channels).map(([k, c]) => `<option value="${k}" ${d.channel === k ? 'selected' : ''}>${esc(c.label)}${c.fixedCost ? ' – costo fisso ' + eur(c.fixedCost) : ''}${c.priceShare < 1 ? ' – incassate il ' + Math.round(c.priceShare * 100) + '% del prezzo' : ''}</option>`).join('')}
            </select></div>
          </div>
          <label>Motivazione della scelta <small>(servirà per il debriefing)</small></label>
          <textarea name="notes" maxlength="500">${esc(r.decision ? r.decision.notes : '')}</textarea>
          <p id="estimate" class="msg info"></p>
          <div class="row"><button type="submit" class="primary-blue" ${canSubmit ? '' : 'disabled'}>Invia decisioni</button><span id="savedInfo" class="muted"></span></div>
        </form>
        <div id="decisionMsg"></div>
      </div>`;

    const f = $('#decisionForm');
    const estimate = () => {
      if (!seg) return;
      const v = (n) => Number(f[n].value) || 0;
      const ch = data.market.channels[f.channel.value] || {};
      const spend = v('production') * seg.unitCost + v('marketing') + v('design') + v('sustainability') + data.market.fixedCostPerRound + (ch.fixedCost || 0);
      $('#estimate').innerHTML = `Uscite stimate del round (costo unitario base, esclusi effetti di qualità ed eventi): <strong>${eur(spend)}</strong>` +
        (spend > cash ? ' — <strong>superano la cassa disponibile</strong>' : '');
    };
    f.addEventListener('input', estimate);
    estimate();
    if (!canSubmit) $$('input, select, textarea', f).forEach((el) => { el.disabled = true; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(['price', 'production', 'marketing', 'design', 'sustainability', 'channel', 'notes'].map((k) => [k, f[k].value]));
      try {
        await api('PUT', '/api/student/decision', body);
        msg('#decisionMsg', 'Decisioni salvate. Potete modificarle finché il docente non chiude il round.', 'ok');
        await refresh();
      } catch (err) { msg('#decisionMsg', err.message); }
    });
    updateSaved();
  }
  function updateSaved() {
    const el = $('#savedInfo');
    if (!el || !data.openRound) return;
    el.textContent = data.openRound.savedAt ? 'Ultimo salvataggio: ' + new Date(data.openRound.savedAt).toLocaleTimeString('it-IT') : 'Non ancora inviate';
  }

  // ---------- risultati del gruppo ----------
  function renderResults() {
    const h = data.history;
    if (!h.length) { $('#resultsPanel').innerHTML = '<div class="panel"><p class="muted">I risultati compaiono quando il docente chiude e calcola un round.</p></div>'; return; }
    const last = h[h.length - 1];
    $('#resultsPanel').innerHTML = `
      <div class="panel"><h2>Situazione dopo il round ${last.round}</h2>
        <div class="grid3">
          <div class="kpi"><div class="label">Posizione</div><div class="value">${last.rank}°</div></div>
          <div class="kpi"><div class="label">Punteggio</div><div class="value">${num(last.score, 1)}</div></div>
          <div class="kpi"><div class="label">Cassa</div><div class="value">${eur(last.cash)}</div></div>
          <div class="kpi"><div class="label">Utile cumulato</div><div class="value">${eur(last.cum_profit)}</div></div>
          <div class="kpi"><div class="label">Brand equity</div><div class="value">${num(last.brand, 1)}</div></div>
          <div class="kpi"><div class="label">Qualità</div><div class="value">${num(last.quality, 1)}</div></div>
          <div class="kpi"><div class="label">Sostenibilità</div><div class="value">${num(last.sustainability, 1)}</div></div>
          <div class="kpi"><div class="label">Quota di mercato</div><div class="value">${num(last.market_share, 1)}%</div></div>
        </div>
      </div>
      <div class="panel"><h2>Storico per round</h2><div class="table-wrap"><table>
        <thead><tr><th>Round</th><th class="n">Prezzo</th><th class="n">Prodotti</th><th class="n">Venduti</th><th class="n">Vendite perse</th><th class="n">Ricavi</th><th class="n">Costi</th><th class="n">Utile</th><th class="n">Cassa</th><th class="n">Brand</th><th class="n">Sost.</th><th class="n">Pos.</th></tr></thead>
        <tbody>${h.map((r) => `<tr><td>${r.round}${r.auto ? ' <small>(auto)</small>' : ''}</td><td class="n">${eur(r.decision && r.decision.price)}</td><td class="n">${num(r.decision && r.decision.production)}</td>
          <td class="n">${num(r.units_sold)}</td><td class="n">${num(r.lost_sales)}</td><td class="n">${eur(r.revenue)}</td><td class="n">${eur(r.total_costs)}</td>
          <td class="n">${eur(r.profit)}</td><td class="n">${eur(r.cash)}</td><td class="n">${num(r.brand, 1)}</td><td class="n">${num(r.sustainability, 1)}</td><td class="n">${r.rank}</td></tr>`).join('')}</tbody>
      </table></div><p class="muted"><small>"Vendite perse": domanda che non avete potuto servire perché la produzione non bastava.</small></p></div>`;
  }

  function renderBoard() {
    const b = data.leaderboard;
    if (!b) { $('#boardPanel').innerHTML = '<div class="panel"><p class="muted">Il docente ha scelto di non mostrare la classifica durante il gioco.</p></div>'; return; }
    if (!b.rows.length) { $('#boardPanel').innerHTML = '<div class="panel"><p class="muted">La classifica comparirà dopo il primo round calcolato.</p></div>'; return; }
    $('#boardPanel').innerHTML = `<div class="panel"><h2>Classifica dopo il round ${b.round}</h2><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Gruppo</th><th>Startup</th><th>Segmento</th><th>Mercato</th><th class="n">Punteggio</th></tr></thead>
      <tbody>${b.rows.map((r) => `<tr class="${r.isMe ? 'me' : ''}"><td>${r.rank}</td><td>${esc(r.groupName)}</td><td>${esc(r.startupName)}</td><td>${esc(SEG[r.segment] || r.segment)}</td><td>${esc(MKT[r.market] || r.market)}</td><td class="n">${num(r.score, 1)}</td></tr>`).join('')}</tbody>
    </table></div><p class="muted"><small>Il punteggio combina utile cumulato, brand, quota di mercato, sostenibilità e cassa.</small></p></div>`;
  }

  function renderMarket() {
    const ev = [...data.events].reverse();
    $('#marketPanel').innerHTML = `
      <div class="panel"><h2>Startup concorrenti</h2>
        ${data.competitors.length ? `<div class="table-wrap"><table><thead><tr><th>Startup</th><th>Segmento</th><th>Categoria</th><th>Mercato</th><th>Posizionamento</th></tr></thead><tbody>
        ${data.competitors.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(SEG[c.segment])}</td><td>${esc(c.category)}</td><td>${esc(MKT[c.market])}</td><td>${esc(c.positioning)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Nessun\'altra startup registrata finora.</p>'}
        <p class="muted"><small>Competete direttamente con le startup che hanno scelto lo stesso segmento e lo stesso mercato.</small></p>
      </div>
      <div class="panel"><h2>Eventi annunciati</h2>
        ${ev.length ? ev.map((r) => `<h3 class="mt">Round ${r.round}</h3>` + r.events.map((e) => `<div class="event"><div><strong>${esc(e.title)}</strong>${esc(e.description)}</div></div>`).join('')).join('') : '<p class="muted">Nessun evento finora.</p>'}
      </div>`;
  }

  // Avvio: se il dispositivo è già collegato a un gruppo entra direttamente
  api('GET', '/api/student/state').then(() => start()).catch(() => show('join'));
})();
