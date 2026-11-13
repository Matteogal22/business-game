// Area studenti
(function () {
  const { api, esc, eur, num, $, $$, badge, SEG, MKT, CH, CAT, setLabels, cap, price, MODULES, makeTimer, makeRoundTimer, ringHTML } = window.BG;
  let data = null;
  let formKey = null;
  let pollTimer = null;
  let checkedCode = null;
  $('#sRing').innerHTML = ringHTML();
  const timer = makeTimer($('#sRing'));
  const roundTimer = makeRoundTimer($('#sRoundTimer'));

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
    setLabels(data.market);
    $('#whoami').textContent = data.group.name;
    $('#sGame').textContent = `${data.gameName} · ${data.market.sector.label}`;
    $('#sGroup').textContent = data.startup ? data.startup.name : data.group.name;
    $('#sSub').textContent = data.startup ? `Gruppo ${data.group.name} · ${SEG[data.startup.segment]} · ${MKT[data.startup.market]}` : `Gruppo ${data.group.name}`;
    $('#sStatus').innerHTML = badge(s.status);
    $('#sSession').innerHTML = `${s.currentSession || '–'} <small>/ ${s.numSessions}</small>`;
    $('#sRound').innerHTML = `${s.currentRound} <small>/ ${s.numRounds}</small>`;
    $('#sCash').textContent = eur(last ? last.cash : data.market.startingCash);
    $('#sRank').textContent = last ? last.rank + '°' : '–';
    timer.set(s);
    roundTimer.set(s);

    const notices = [];
    if (data.openRound && data.newModules && data.newModules.length) notices.push(['info', 'Novità da questo round: ' + data.newModules.map((k) => (MODULES[k] ? MODULES[k].label : k)).join(', ') + '. Trovate i dettagli nelle decisioni.']);
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
  let optionsFor = null;
  function fillStartupOptions() {
    const f = $('#startupForm'), m = data.market;
    const key = m.sector.label + Object.keys(m.segments).join() + Object.keys(m.categories).join();
    if (optionsFor === key) return;
    optionsFor = key;
    f.segment.innerHTML = Object.entries(m.segments).map(([k, sg]) => `<option value="${k}">${esc(sg.label)} — prezzo tipico ${price(sg.refPrice)}</option>`).join('');
    f.category.innerHTML = Object.entries(m.categories).map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('');
    $('#sectorBox').innerHTML = `<div class="tip"><b>Settore: ${esc(m.sector.label)}.</b> ${(m.sector.rules || []).map(esc).join(' · ')}</div>`;
    updateStartupInfo();
  }
  function updateStartupInfo() {
    const f = $('#startupForm'), m = data.market;
    const sg = m.segments[f.segment.value], c = m.categories[f.category.value];
    const SENS = { poco: 'clienti poco sensibili al prezzo', abbastanza: 'clienti abbastanza sensibili al prezzo', molto: 'clienti molto sensibili al prezzo' };
    $('#segInfo').innerHTML = sg ? `<span class="chip">prezzo tipico ${price(sg.refPrice)}</span><span class="chip">costo di un pezzo ${price(sg.unitCost)}</span><span class="chip">${SENS[sg.sensitivity]}</span>${sg.prestige ? '<span class="chip w">un prezzo troppo basso rovina il prestigio</span>' : ''}` : '';
    $('#catInfo').innerHTML = c ? `<span class="chip">margine ${esc(c.margin)}</span><span class="chip ${c.spoilRate >= 0.4 ? 'w' : ''}">rischio invenduto: ${esc(c.obsolescence)}</span>` : '';
  }
  $('#startupForm').addEventListener('change', (e) => { if (['segment', 'category'].includes(e.target.name)) updateStartupInfo(); });
  function renderStartup() {
    fillStartupOptions();
    const f = $('#startupForm');
    const locked = data.startupLocked;
    $('#startupHint').textContent = locked
      ? 'Segmento e mercato sono bloccati dopo il primo round calcolato. Nome, categoria, posizionamento e valori restano modificabili.'
      : 'Scegliete con cura segmento e mercato: dopo il primo round non si potranno più cambiare.';
    f.segment.disabled = locked; f.market.disabled = locked;
    if (!startupFilled && data.startup) {
      for (const k of ['name', 'segment', 'category', 'market', 'positioning', 'values_text']) f[k].value = data.startup[k] || '';
      startupFilled = true;
      updateStartupInfo();
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
  // ---------- round: passo 1 decisioni, passo 2 studio ----------
  let step = 1;
  // Stessa formula del server: investimenti con rendimenti decrescenti
  const grow = (level, spend, decay) => Math.max(0, Math.min(100, level + 12 * Math.log(1 + Math.max(0, spend) / 20000) * (1 - level / 100) - decay * level));

  function renderRound() {
    const s = data.state;
    const r = data.openRound;
    const canSubmit = !!(r && s.status === 'running' && data.startup && data.codeStatus === 'active');
    const key = [r ? r.number : 0, canSubmit, data.startup ? data.startup.segment + data.startup.category : '-', JSON.stringify(data.modules || {})].join('|');
    const evThis = r ? (data.events.find((e) => e.round === r.number) || { events: [] }).events : [];

    if (key === formKey) { updateSaved(); renderFiles(); return; }
    formKey = key;

    if (!r) {
      step = 1;
      const last = data.history[data.history.length - 1];
      $('#roundPanel').innerHTML = `<div class="panel"><h2>Nessun round aperto</h2>
        <p class="lead">${s.currentRound ? `Il round ${s.currentRound} è stato chiuso e calcolato.` : 'La docente non ha ancora aperto il primo round.'}
        La pagina si aggiorna da sola.</p>
        ${last ? `<p>Ultimo risultato: utile ${eur(last.profit)}, posizione <strong>${last.rank}°</strong>. Nella scheda <strong>Risultati</strong> trovate il punteggio spiegato voce per voce.</p>` : ''}</div>`;
      return;
    }

    const seg = data.startup ? data.market.segments[data.startup.segment] : null;
    const segKey = data.startup ? data.startup.segment : Object.keys(data.market.segments)[0];
    const cat = data.startup ? data.market.categories[data.startup.category] : null;
    const word = data.market.sector.productWord || 'pezzi';
    const mods = data.modules || {};
    const prevDec = r.decision || (data.history.length ? data.history[data.history.length - 1].decision : null);
    const firstCh = Object.keys(data.market.channels)[0];
    const d = { sourcing: 'europa', ...(prevDec || (seg ? { price: seg.refPrice, production: Math.round((seg.baseDemand || 10000) * 0.15), marketing: 20000, design: 15000, sustainability: 10000, channel: firstCh } : {})) };
    if (!data.market.channels[d.channel]) d.channel = firstCh;
    const last = data.history[data.history.length - 1];
    const cash = last ? last.cash : data.market.startingCash;
    const inventory = last ? last.inventory : 0;
    const cur = last ? { brand: last.brand, quality: last.quality, sustainability: last.sustainability } : data.market.start;
    const lastDemand = last && last.details ? last.details.demand : null;
    const an = r.analysis || {};

    const field = (name, label, hint, input, help, chipId) => `<div class="field-h"><div class="lab-row"><label for="f_${name}">${label}</label><span class="hint">${hint}</span></div>${input}
      <div class="help">${help}</div>${chipId ? `<div class="chips" id="${chipId}"></div>` : ''}</div>`;
    const numIn = (name, val, step) => `<input id="f_${name}" name="${name}" type="number" min="0" step="${step}" value="${esc(val)}" required>`;

    $('#roundPanel').innerHTML = `
      <div class="panel">
        <div class="row"><h2>Round ${r.number}</h2><span class="spacer"></span><div class="tabs stepper" id="stepper"><button type="button" data-step="1">1 · Decisioni</button><button type="button" data-step="2">2 · Il vostro studio</button></div></div>
        <p class="lead">${evThis.length ? 'Eventi annunciati per questo round:' : 'Nessun evento particolare annunciato per questo round.'}</p>
        ${evThis.map((e) => `<div class="event"><div><strong>${esc(e.title)}</strong>${esc(e.description)}</div></div>`).join('')}
        ${!canSubmit ? '<div class="msg warn">In questo momento non si possono inviare decisioni (sessione in pausa, chiusa o startup non configurata).</div>' : ''}
      </div>

      <form id="roundForm" novalidate>
        <div id="step1" class="panel">
          <h2>Le vostre decisioni</h2>
          <p class="lead">Sotto ogni campo trovate cosa fa e l'effetto previsto.</p>
          <div class="grid3">
            <div class="kpi"><div class="label">Cassa disponibile</div><div class="value">${eur(cash)}</div></div>
            <div class="kpi"><div class="label">In magazzino</div><div class="value">${num(inventory)} <small>${esc(word)}</small></div></div>
            <div class="kpi"><div class="label">Brand · Qualità · Sostenibilità</div><div class="value">${num(cur.brand)} · ${num(cur.quality)} · ${num(cur.sustainability)}</div></div>
          </div>
          <div class="grid2 mt">
            ${field('price', 'Prezzo di vendita (€)', seg ? `prezzo tipico ${esc(seg.label)}: ${price(seg.refPrice)}` : '', numIn('price', d.price, 'any'),
              seg && seg.prestige
                ? `<b>Cosa fa:</b> più alto = più margine su ogni unità venduta, ma meno clienti. I vostri clienti sono poco sensibili al prezzo, però sotto ${price(seg.refPrice * 0.6)} il brand perde prestigio.`
                : `<b>Cosa fa:</b> più alto = più margine, ma meno clienti. ${seg && seg.sensitivity === 'molto' ? 'I vostri clienti sono molto sensibili al prezzo: anche piccoli aumenti fanno perdere vendite.' : 'I vostri clienti sono abbastanza sensibili al prezzo.'}`, 'chip_price')}
            ${field('production', `${cap(word)} da produrre`, lastDemand !== null ? `domanda per voi lo scorso round: ${num(lastDemand)}` : 'primo round: nessun dato sulla domanda', numIn('production', d.production, 1),
              `<b>Cosa fa:</b> se ne producete pochi perdete vendite; se troppi, l'invenduto resta in magazzino (costa il ${Math.round((data.market.holdingCostRate || 0.1) * 100)}% del costo di produzione) e passa al round dopo.${cat && cat.spoilRate > 0 ? ` <b>Attenzione:</b> per ${esc(cat.label.toLowerCase())} ${cat.spoilRate >= 1 ? 'l\'invenduto scade e si perde tutto' : `ogni round si perde il ${Math.round(cat.spoilRate * 100)}% dell'invenduto`}.` : ''}`, 'chip_production')}
            ${field('marketing', 'Marketing (€)', `brand attuale ${num(cur.brand)}/100`, numIn('marketing', d.marketing, 1000),
              '<b>Cosa fa:</b> fa crescere la forza del brand, che attira clienti. I primi euro rendono molto, poi sempre meno. Se non investite, il brand cala un po\' ogni round.', 'chip_marketing')}
            ${field('design', 'Design / R&D (€)', `qualità attuale ${num(cur.quality)}/100`, numIn('design', d.design, 1000),
              '<b>Cosa fa:</b> migliora la qualità del prodotto: più clienti, ma anche un costo per pezzo un po\' più alto.', 'chip_design')}
            ${field('sustainability', 'Sostenibilità (€)', `attuale ${num(cur.sustainability)}/100`, numIn('sustainability', d.sustainability, 1000),
              '<b>Cosa fa:</b> i clienti premiano i brand sostenibili, e alcuni eventi (scandali, nuove leggi) penalizzano chi è sotto 40.', 'chip_sustainability')}
            ${field('channel', 'Canale di vendita', '', `<select id="f_channel" name="channel">${Object.entries(data.market.channels).map(([k, c]) => `<option value="${k}" ${d.channel === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`,
              '<span id="chHelp"></span>', 'chip_channel')}
            ${mods.sourcing ? field('sourcing', 'Dove producete', 'novità attivata dalla docente', `<select id="f_sourcing" name="sourcing">${Object.entries(data.market.sourcing).map(([k, x]) => `<option value="${k}" ${d.sourcing === k ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`,
              '<b>Cosa fa:</b> produrre vicino costa di più ma migliora qualità e sostenibilità; produrre lontano costa meno, ma la filiera lunga soffre di più le crisi logistiche.', 'chip_sourcing') : ''}
          </div>
          <div class="preview mt" id="preview"></div>
          <p class="row mt"><button type="button" id="toStep2" class="primary-blue">Avanti: il vostro studio →</button></p>
        </div>

        <div id="step2" class="panel">
          <h2>Il vostro studio</h2>
          <p class="lead">Spiegate il ragionamento dietro le decisioni. La docente lo legge e, alla fine, lo valuta: il suo giudizio entra nella classifica finale.</p>
          <div class="study">
            <label for="a_market">1 · Mercato ed eventi</label>
            <textarea id="a_market" name="market" maxlength="2000" placeholder="Cosa sta succedendo nel vostro mercato? Come vi toccano gli eventi di questo round?">${esc(an.market || '')}</textarea>
            <label for="a_competitors">2 · Concorrenti</label>
            <textarea id="a_competitors" name="competitors" maxlength="2000" placeholder="Chi compete nel vostro stesso mercato? Cosa stanno facendo? Come vi differenziate?">${esc(an.competitors || '')}</textarea>
            <label for="a_strategy">3 · Strategia e alternative scartate</label>
            <textarea id="a_strategy" name="strategy" maxlength="2000" placeholder="Perché queste decisioni? Quali alternative avete valutato e perché le avete scartate?">${esc(an.strategy || '')}</textarea>
            <label for="a_risks">4 · Rischi</label>
            <textarea id="a_risks" name="risks" maxlength="2000" placeholder="Cosa potrebbe andare storto? Cosa fareste in quel caso?">${esc(an.risks || '')}</textarea>
            <label>5 · La vostra previsione per questo round</label>
            <div class="grid2">
              <div><small>Pezzi che pensate di vendere</small><input name="forecast_units" type="number" min="0" step="any" value="${an.forecast_units ?? ''}"></div>
              <div><small>Utile (o perdita) previsto in €</small><input name="forecast_profit" type="number" step="any" value="${an.forecast_profit ?? ''}"></div>
            </div>
            <p class="help">Dopo il round confronterete la previsione con il risultato reale.</p>
          </div>
          <h3 class="mt">Allegati <small>— facoltativi: lo studio completo (PDF, slide, immagini, Word, Excel)</small></h3>
          <div id="fileList"></div>
          <label class="upload ${canSubmit ? '' : 'disabled'}"><input type="file" id="fileInput" accept=".pdf,.png,.jpg,.jpeg,.pptx,.docx,.xlsx" ${canSubmit ? '' : 'disabled'}><span>＋ Carica un file</span><small>max ${data.limits.maxFileMb} MB · fino a ${data.limits.maxFiles} file per round</small></label>
          <div id="fileMsg"></div>
          <p class="row mt"><button type="button" id="toStep1" class="secondary">← Decisioni</button><button type="submit" class="primary-blue" ${canSubmit ? '' : 'disabled'}>Invia decisioni e studio</button><span id="savedInfo" class="muted"></span></p>
        </div>
      </form>
      <div id="decisionMsg"></div>`;

    const f = $('#roundForm');
    const showStep = (n) => {
      step = n;
      $('#step1').classList.toggle('hidden', n !== 1);
      $('#step2').classList.toggle('hidden', n !== 2);
      $$('#stepper button').forEach((b) => b.classList.toggle('active', Number(b.dataset.step) === n));
    };
    $('#stepper').addEventListener('click', (e) => { const b = e.target.closest('button[data-step]'); if (b) showStep(Number(b.dataset.step)); });
    $('#toStep2').addEventListener('click', () => { showStep(2); $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#toStep1').addEventListener('click', () => showStep(1));
    showStep(step);

    // Anteprima degli effetti mentre si compila
    const chip = (id, html) => { const el = $('#' + id); if (el) el.innerHTML = html; };
    const update = () => {
      if (!seg) return;
      const v = (n) => Number(f[n].value) || 0;
      const ch = data.market.channels[f.channel.value] || {};
      const dec = data.market.decay || { brand: 0.05, quality: 0.08, sustainability: 0.05 };
      const nb = grow(cur.brand, v('marketing'), dec.brand), nq = grow(cur.quality, v('design'), dec.quality), ns = grow(cur.sustainability, v('sustainability'), dec.sustainability);
      const ratio = v('price') / seg.refPrice;
      const pct = Math.round((ratio - 1) * 100);
      chip('chip_price', `<span class="chip">${pct === 0 ? 'uguale al prezzo tipico' : (pct > 0 ? '+' : '') + pct + '% rispetto al prezzo tipico'}</span>` +
        (seg.prestige && ratio < 0.6 ? '<span class="chip w">Troppo basso: il brand perde prestigio</span>' : '') +
        (seg.sensitivity === 'molto' && ratio > 1.3 ? '<span class="chip w">Molto sopra il tipico: i vostri clienti sono sensibili al prezzo</span>' : ''));
      const avail = v('production') + inventory;
      chip('chip_production', `<span class="chip">${esc(cap(word))} disponibili da vendere: ${num(avail)}${inventory ? ` (di cui ${num(inventory)} in magazzino)` : ''}</span>` +
        (lastDemand !== null && avail < lastDemand * 0.7 ? '<span class="chip w">Molto sotto la domanda dello scorso round: rischio vendite perse</span>' : '') +
        (lastDemand !== null && avail > lastDemand * 1.6 ? '<span class="chip w">Molto sopra la domanda dello scorso round: rischio invenduto</span>' : ''));
      const trend = (a, b) => `${num(a)} → ${num(b)}`;
      chip('chip_marketing', `<span class="chip ${nb >= cur.brand ? 'g' : 'w'}">Brand previsto: ${trend(cur.brand, nb)}</span>`);
      chip('chip_design', `<span class="chip ${nq >= cur.quality ? 'g' : 'w'}">Qualità prevista: ${trend(cur.quality, nq)}</span>`);
      chip('chip_sustainability', `<span class="chip ${ns >= cur.sustainability ? 'g' : 'w'}">Sostenibilità prevista: ${trend(cur.sustainability, ns)}</span>` +
        (ns < 40 ? '<span class="chip w">Sotto 40: rischio penalità con eventi sulla filiera</span>' : ''));
      $('#chHelp').innerHTML = `<b>Cosa fa:</b> ${esc((data.market.channels[f.channel.value] || {}).desc || '')}`;
      const src = mods.sourcing && f.sourcing ? data.market.sourcing[f.sourcing.value] : null;
      if (src) chip('chip_sourcing', `<span class="chip ${src.cost > 1 ? 'w' : 'g'}">costo di produzione ${src.cost > 1 ? '+' : '−'}${Math.round(Math.abs(src.cost - 1) * 100)}%</span><span class="chip ${src.quality >= 0 ? 'g' : 'w'}">qualità ${src.quality >= 0 ? '+' : ''}${src.quality} a round</span><span class="chip ${src.sustainability >= 0 ? 'g' : 'w'}">sostenibilità ${src.sustainability >= 0 ? '+' : ''}${src.sustainability} a round</span><span class="chip ${src.eventExposure > 1 ? 'w' : ''}">rischio crisi logistiche: ${src.eventExposure > 1 ? 'alto' : src.eventExposure < 1 ? 'basso' : 'medio'}</span>`);
      const reach = (data.market.channelReach[f.channel.value] || {})[segKey] || 1;
      chip('chip_channel', `<span class="chip">Costo fisso ${eur(ch.fixedCost || 0)} a round</span><span class="chip">Incassate il ${Math.round((ch.priceShare ?? 1) * 100)}% del prezzo</span><span class="chip ${reach >= 1 ? 'g' : 'w'}">Clienti raggiunti: ${reach >= 1 ? '+' : ''}${Math.round((reach - 1) * 100)}%</span>`);
      const MARGIN = { basso: 1.15, medio: 1, alto: 0.85, molto_alto: 0.7 };
      const unit = seg.unitCost * (cat ? MARGIN[cat.marginKey] || 1 : 1) * (src ? src.cost : 1) * (1 + (nq - 50) / 150) * (1 + (ns - 50) / 300);
      const spend = v('production') * unit + v('marketing') + v('design') + v('sustainability') + data.market.fixedCostPerRound + (ch.fixedCost || 0);
      const maxRev = avail * v('price') * (ch.priceShare ?? 1);
      $('#preview').innerHTML = `<div class="pv-row"><span>Uscite stimate del round</span><b>${eur(spend)}</b></div>
        <div class="pv-row"><span>Costo di produzione per unità</span><b>${price(unit)}</b></div>
        <div class="pv-row"><span>Cassa dopo le uscite</span><b class="${cash - spend < 0 ? 'neg' : ''}">${eur(cash - spend)}</b></div>
        ${mods.credit && cash - spend < 0 ? `<div class="pv-row"><span>Se a fine round la cassa resta negativa: interessi del fido (${Math.round(data.market.creditRate * 100)}%)</span><b class="neg">circa ${eur((spend - cash) * data.market.creditRate)}</b></div>` : ''}
        <div class="pv-row"><span>Ricavo se vendete tutti i pezzi</span><b>${eur(maxRev)}</b></div>
        <small>Stime indicative: il risultato vero dipende dai concorrenti e dagli eventi.</small>`;
    };
    f.addEventListener('input', update);
    update();
    if (!canSubmit) $$('input, select, textarea', f).forEach((el) => { el.disabled = true; });

    $('#fileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > data.limits.maxFileMb * 1048576) return msg('#fileMsg', `Il file supera ${data.limits.maxFileMb} MB.`);
      msg('#fileMsg', 'Caricamento in corso…', 'info');
      try {
        const res = await fetch('/api/student/attachments', { method: 'POST', credentials: 'same-origin', body: file,
          headers: { 'X-Requested-With': 'business-game', 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Caricamento non riuscito.');
        msg('#fileMsg', 'File caricato.', 'ok');
        await refresh();
      } catch (err) { msg('#fileMsg', err.message); }
    });
    $('#fileList').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-del]');
      if (!b || !confirm('Eliminare questo file?')) return;
      try { await api('DELETE', '/api/student/attachments/' + b.dataset.del); await refresh(); } catch (err) { msg('#fileMsg', err.message); }
    });

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(['price', 'production', 'marketing', 'design', 'sustainability', 'channel'].map((k) => [k, f[k].value]));
      if (f.sourcing) body.sourcing = f.sourcing.value;
      const analysis = Object.fromEntries(['market', 'competitors', 'strategy', 'risks', 'forecast_units', 'forecast_profit'].map((k) => [k, f[k].value]));
      try {
        await api('PUT', '/api/student/decision', body);
        await api('PUT', '/api/student/analysis', analysis);
        const filled = ['market', 'competitors', 'strategy', 'risks'].filter((k) => analysis[k].trim()).length;
        msg('#decisionMsg', `Decisioni e studio salvati (${filled} domande su 4 compilate). Potete modificarli finché la docente non chiude il round.`, 'ok');
        await refresh();
      } catch (err) {
        if (err.message && /Prezzo|Produzione|Marketing|Design|Sostenibilità|Canale/.test(err.message)) showStep(1);
        msg('#decisionMsg', err.message);
      }
    });
    renderFiles();
    updateSaved();
  }

  function renderFiles() {
    const el = $('#fileList');
    if (!el || !data.openRound) return;
    const canDel = data.state.status === 'running' && data.codeStatus === 'active';
    el.innerHTML = data.openRound.files.map((f) => `<div class="file-row"><span class="file-ico">${esc((f.filename.split('.').pop() || '').toUpperCase().slice(0, 4))}</span>
      <a href="/api/student/attachments/${f.id}">${esc(f.filename)}</a><small>${num(f.size / 1024)} KB</small><span class="spacer"></span>
      ${canDel ? `<button type="button" class="small danger" data-del="${f.id}">Elimina</button>` : ''}</div>`).join('');
  }
  function updateSaved() {
    const el = $('#savedInfo');
    if (!el || !data.openRound) return;
    el.textContent = data.openRound.savedAt ? 'Ultimo invio: ' + new Date(data.openRound.savedAt).toLocaleTimeString('it-IT') : 'Non ancora inviate';
  }

  // ---------- risultati del gruppo: punteggio spiegato ----------
  const PART_LABEL = { cumProfit: 'Utile cumulato', brand: 'Forza del brand', marketShare: 'Quota di mercato', sustainability: 'Sostenibilità', cash: 'Cassa disponibile' };
  function scoreExplain(last) {
    const parts = last.details && last.details.scoreParts;
    if (!parts) return '';
    const entries = Object.entries(parts);
    const best = [...entries].sort((a, b) => b[1].points - a[1].points)[0];
    const worst = [...entries].sort((a, b) => a[1].points - b[1].points)[0];
    const bars = entries.map(([k, p]) => `<div class="sb"><div class="t">${PART_LABEL[k]} <span>${Math.round(p.weight * 100)}% · ${num(p.points)} pt</span></div><div class="bar"><i data-w="${p.points}" class="${p.points < 35 ? 'low' : ''}"></i></div></div>`).join('');
    return `<div class="panel"><h2>Perché siete ${last.rank}°</h2>
      <div class="big"><b>${num(last.score, 1)}</b><span>punti su 100 dopo il round ${last.round}</span></div>
      ${bars}
      <div class="tip mt"><b>In sintesi:</b> il vostro punto forte è <b>${PART_LABEL[best[0]].toLowerCase()}</b>, quello debole è <b>${PART_LABEL[worst[0]].toLowerCase()}</b>.
        Ogni voce vi confronta con gli altri gruppi: il migliore prende 100, il peggiore 0. Migliorare la voce più debole è il modo più rapido per salire.</div>
      ${last.analysis && (last.analysis.forecast_units != null || last.analysis.forecast_profit != null) ? `<h3 class="mt">La vostra previsione e il risultato reale</h3><div class="grid2">
        ${last.analysis.forecast_units != null ? `<div class="kpi"><div class="label">${esc(cap(data.market.sector.productWord))} venduti: previsti → reali</div><div class="value">${num(last.analysis.forecast_units)} → ${num(last.units_sold)}</div></div>` : ''}
        ${last.analysis.forecast_profit != null ? `<div class="kpi"><div class="label">Utile: previsto → reale</div><div class="value">${eur(last.analysis.forecast_profit)} → ${eur(last.profit)}</div></div>` : ''}
      </div>` : ''}
    </div>`;
  }
  function renderResults() {
    const h = data.history;
    const ev = data.evaluation;
    const evHtml = ev ? `<div class="hero on-dark"><div class="eyebrow">Giudizio finale della docente</div><h1>${num(ev.vote, 1)} / 10</h1>
      ${ev.comment ? `<p class="sub">${esc(ev.comment)}</p>` : ''}
      <div class="hero-stats"><div class="stat"><div class="l">Punteggio finale</div><div class="v">${ev.finalScore != null ? num(ev.finalScore, 1) : '–'}</div></div>
      <div class="stat"><div class="l">Posizione finale</div><div class="v">${ev.finalRank ? ev.finalRank + '°' : '–'}</div></div>
      <div class="stat"><div class="l">Peso del giudizio</div><div class="v">${Math.round(ev.weight * 100)}%</div></div></div></div>` : '';
    const aw = awardsHTML();
    if (!h.length) { $('#resultsPanel').innerHTML = evHtml + aw + '<div class="panel"><p class="muted">I risultati compaiono quando la docente chiude e calcola un round.</p></div>'; return; }
    const last = h[h.length - 1];
    $('#resultsPanel').innerHTML = evHtml + aw + scoreExplain(last) + `
      <div class="panel"><h2>Situazione dopo il round ${last.round}</h2>
        <div class="grid3">
          <div class="kpi"><div class="label">Cassa</div><div class="value">${eur(last.cash)}</div></div>
          <div class="kpi"><div class="label">Utile cumulato</div><div class="value">${eur(last.cum_profit)}</div></div>
          <div class="kpi"><div class="label">Quota di mercato</div><div class="value">${num(last.market_share, 1)}%</div></div>
          <div class="kpi"><div class="label">Brand</div><div class="value">${num(last.brand, 1)}</div></div>
          <div class="kpi"><div class="label">Qualità</div><div class="value">${num(last.quality, 1)}</div></div>
          <div class="kpi"><div class="label">Sostenibilità</div><div class="value">${num(last.sustainability, 1)}</div></div>
        </div>
      </div>
      <div class="panel"><h2>Storico per round</h2><div class="table-wrap"><table>
        <thead><tr><th>Round</th><th class="n">Prezzo</th><th class="n">Prodotti</th><th class="n">Venduti</th><th class="n">Vendite perse</th><th class="n">Invenduto perso</th><th class="n">Ricavi</th><th class="n">Costi</th><th class="n">Utile</th><th class="n">Cassa</th><th class="n">Punteggio</th><th class="n">Pos.</th></tr></thead>
        <tbody>${h.map((r) => `<tr><td>${r.round}${r.auto ? ' <small>(auto)</small>' : ''}</td><td class="n">${price(r.decision && r.decision.price)}</td><td class="n">${num(r.decision && r.decision.production)}</td>
          <td class="n">${num(r.units_sold)}</td><td class="n">${num(r.lost_sales)}</td><td class="n">${num(r.details.spoiled || 0)}</td><td class="n">${eur(r.revenue)}</td><td class="n">${eur(r.total_costs)}</td>
          <td class="n">${eur(r.profit)}</td><td class="n">${eur(r.cash)}${r.details.interest ? `<br><small class="muted">interessi ${eur(r.details.interest)}</small>` : ''}</td><td class="n">${num(r.score, 1)}</td><td class="n">${r.rank}°</td></tr>`).join('')}</tbody>
      </table></div><p class="muted"><small>"Vendite perse": clienti che volevano comprare ma la produzione era finita. "Invenduto perso": la parte di magazzino che è passata di stagione, scaduta o diventata obsoleta. "(auto)": decisione ripetuta perché non inviata in tempo.</small></p></div>`;
    $$('#resultsPanel .bar i').forEach((i) => { i.style.width = Math.max(2, Number(i.dataset.w)) + '%'; });
  }

  function awardsHTML() {
    if (!data.awards || !data.awards.length) return '';
    return `<div class="panel"><h2>Premi speciali</h2><div class="awards">${data.awards.map((a) => `<div class="award ${a.winner && data.startup && a.winner.startupName === data.startup.name ? 'me' : ''}">
      <span class="aw-ico">★</span><div><b>${esc(a.label)}</b><span>${esc(a.winner ? a.winner.startupName : '–')} · ${esc(a.value)}</span><small>${esc(a.desc)}</small></div></div>`).join('')}</div></div>`;
  }

  function renderBoard() {
    const b = data.leaderboard;
    if (!b) { $('#boardPanel').innerHTML = '<div class="panel"><p class="muted">La docente ha scelto di non mostrare la classifica durante il gioco.</p></div>'; return; }
    if (!b.rows.length) { $('#boardPanel').innerHTML = '<div class="panel"><p class="muted">La classifica comparirà dopo il primo round calcolato.</p></div>'; return; }
    $('#boardPanel').innerHTML = awardsHTML() + `<div class="panel"><h2>${b.final ? 'Classifica finale' : `Classifica dopo il round ${b.round}`}</h2><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Startup</th><th>Gruppo</th><th>Mercato</th>${b.final ? '<th class="n">Gioco</th>' : ''}<th class="n">${b.final ? 'Finale' : 'Punteggio'}</th></tr></thead>
      <tbody>${b.rows.map((r) => `<tr class="${r.isMe ? 'me' : ''}"><td><strong>${r.rank}</strong></td><td>${esc(r.startupName)}<br><small>${esc(SEG[r.segment] || r.segment)}</small></td><td>${esc(r.groupName)}</td><td>${esc(MKT[r.market] || r.market)}</td>${b.final ? `<td class="n">${num(r.gameScore, 1)}</td>` : ''}<td class="n"><strong>${num(r.score, 1)}</strong></td></tr>`).join('')}</tbody>
    </table></div><p class="muted"><small>${b.final ? `Punteggio finale = ${100 - Math.round(b.weight * 100)}% risultati del gioco + ${Math.round(b.weight * 100)}% giudizio della docente sul ragionamento.` : 'Il punteggio combina utile cumulato, brand, quota di mercato, sostenibilità e cassa, confrontati con gli altri gruppi. Alla fine si aggiunge il giudizio della docente.'}</small></p></div>`;
  }

  function renderMarket() {
    const ev = [...data.events].reverse();
    const rep = data.reports && data.reports[0];
    const mine = data.startup ? data.startup.segment + '|' + data.startup.market : '';
    const reportHTML = rep ? `<div class="panel"><h2>Report di mercato · round ${rep.round}</h2>
      <p class="lead">I dati che un manager troverebbe in un'analisi di settore. Il vostro mercato è evidenziato.</p>
      ${rep.pools.map((p) => `<div class="report ${p.segment + '|' + p.market === mine ? 'mine' : ''}"><div class="row"><b>${esc(p.segmentLabel)} · ${esc(MKT[p.market])}</b><span class="spacer"></span>
        <span class="chip">clienti ${num(p.demand)}</span><span class="chip">venduti ${num(p.sold)}</span>${p.unserved ? `<span class="chip w">senza prodotto: ${num(p.unserved)}</span>` : ''}<span class="chip">prezzo medio ${price(p.avgPrice)}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Startup</th><th class="n">Quota</th><th class="n">Prezzo</th><th>Canale</th></tr></thead><tbody>
        ${p.players.map((x) => `<tr class="${data.startup && x.startupName === data.startup.name ? 'me' : ''}"><td>${esc(x.startupName)}</td><td class="n">${num(x.share, 1)}%</td><td class="n">${price(x.price)}</td><td>${esc(x.channel || '–')}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}
      <p class="muted"><small>"Senza prodotto": clienti che avrebbero comprato, ma nessuno aveva abbastanza ${esc(data.market.sector.productWord)}. Quota = venduti sul totale dei clienti del mercato.</small></p></div>` : '';
    $('#marketPanel').innerHTML = reportHTML + `
      <div class="panel"><h2>Startup concorrenti</h2>
        ${data.competitors.length ? `<div class="table-wrap"><table><thead><tr><th>Startup</th><th>Segmento</th><th>Categoria</th><th>Mercato</th><th>Posizionamento</th></tr></thead><tbody>
        ${data.competitors.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(SEG[c.segment] || c.segment)}</td><td>${esc(CAT[c.category] || c.category)}</td><td>${esc(MKT[c.market])}</td><td>${esc(c.positioning)}</td></tr>`).join('')}
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
