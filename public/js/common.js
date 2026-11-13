// Utilità condivise tra area studenti e area docente
(function () {
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'business-game' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Errore di rete.');
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => (n == null || isNaN(n) ? '–' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n));
  const num = (n, d = 0) => (n == null || isNaN(n) ? '–' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n));
  const clock = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const STATUS = {
    setup: ['In preparazione', 'muted'], running: ['In corso', 'ok'], paused: ['In pausa', 'warn'],
    session_closed: ['Sessione chiusa', 'muted'], debrief: ['Debriefing', 'info'], ended: ['Terminata', 'muted'],
  };
  const badge = (status) => { const [l, c] = STATUS[status] || [status, 'muted']; return `<span class="badge ${c}">${esc(l)}</span>`; };
  const CODE_STATUS = { active: ['Attivo', 'ok'], suspended: ['Sospeso', 'warn'], expired: ['Scaduto', 'muted'] };
  const codeBadge = (s) => { const [l, c] = CODE_STATUS[s] || [s, 'muted']; return `<span class="badge ${c}">${esc(l)}</span>`; };
  // Etichette del settore della partita (segmenti, canali, categorie): si aggiornano con setLabels
  const SEG = {}, CH = {}, CAT = {};
  const MKT = { EU: 'Europa', US: 'Stati Uniti', ASIA: 'Asia' };
  function setLabels({ segments = {}, channels = {}, categories = {} } = {}) {
    for (const [o, src] of [[SEG, segments], [CH, channels], [CAT, categories]]) {
      for (const k of Object.keys(o)) delete o[k];
      for (const [k, v] of Object.entries(src)) o[k] = v.label || k;
    }
  }
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const mmssPlain = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  // Markup del timer ad anello (SVG: niente stili inline, compatibile con la CSP)
  const R = 88, CIRC = 2 * Math.PI * R;
  const ringHTML = () => `<div class="ring"><svg viewBox="0 0 200 200" aria-hidden="true">
      <defs><linearGradient id="ringGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#5B8CFF"/><stop offset="1" stop-color="#BFD4FF"/></linearGradient></defs>
      <circle class="track" cx="100" cy="100" r="${R}"/><circle class="bar" cx="100" cy="100" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg>
      <div class="c"><div><div class="time">–:––</div><div class="cap"></div></div></div></div>`;

  // Calcolo del tempo: il server manda il tempo trascorso, il browser lo fa avanzare tra un aggiornamento e l'altro
  // Minuti:secondi anche oltre l'ora (90:00 è più leggibile di 1:30:00 in aula)
  const mmss = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function timeInfo(base) {
    const total = base.sessionMinutes * 60000;
    const elapsed = base.elapsedMs + (base.clockRunning ? Date.now() - base.receivedAt : 0);
    const remaining = total - elapsed;
    return { total, elapsed, remaining, over: remaining < 0, ratio: Math.min(1, elapsed / total), left: Math.max(0, Math.min(1, remaining / total)) };
  }
  function timeLabel(base) {
    const t = timeInfo(base);
    if (!base.currentSession) return { main: mmss(t.total), cap: 'sessione non avviata', t };
    const main = t.over ? '+' + mmss(-t.remaining) : mmss(t.remaining);
    let cap = t.over ? 'tempo superato' : 'rimanenti';
    if (base.status === 'paused') cap = 'in pausa';
    else if (base.status === 'session_closed') cap = 'sessione chiusa';
    else if (['debrief', 'ended'].includes(base.status)) cap = 'gioco concluso';
    return { main, cap, t };
  }

  // Collega un anello (o qualsiasi elemento con .time/.cap) allo stato della partita
  const timers = [];
  let tick = null;
  // Timer del round: elemento con .rt-time e .rt-bar (facoltativa); nascosto se il round non ha durata
  function makeRoundTimer(root, onTick) {
    const entry = { root, onTick, base: null, kind: 'round' };
    timers.push(entry);
    if (!tick) tick = setInterval(() => timers.forEach(renderAny), 1000);
    return { set(state) { entry.base = { ...state, receivedAt: Date.now() }; renderAny(entry); }, attach(el) { entry.root = el; renderAny(entry); } };
  }
  function roundInfo(base) {
    const rt = base && base.roundTimer;
    if (!rt) return null;
    const remaining = rt.remainingMs - (base.clockRunning ? Date.now() - base.receivedAt : 0);
    return { remaining, over: remaining < 0, left: Math.max(0, Math.min(1, remaining / rt.durationMs)), text: remaining < 0 ? '+' + mmssPlain(-remaining) : mmssPlain(remaining) };
  }
  function renderAny(e) { if (e.kind === 'round') renderRoundTimer(e); else renderTimer(e); }
  function renderRoundTimer(e) {
    if (!e.base || !e.root) return;
    const info = roundInfo(e.base);
    e.root.classList.toggle('hidden', !info);
    if (info) {
      const t = e.root.querySelector('.rt-time'); if (t) t.textContent = info.text;
      const b = e.root.querySelector('.rt-bar i'); if (b) b.style.width = Math.round(info.left * 100) + '%';
      const c = e.root.querySelector('.rt-cap'); if (c) c.textContent = info.over ? 'tempo del round scaduto' : (e.base.status === 'running' ? 'alla chiusura del round' : 'timer in pausa');
      e.root.classList.toggle('over', info.over);
    }
    if (e.onTick) e.onTick(info, e.base);
  }

  function makeTimer(root, onTick) {
    const entry = { root, onTick, base: null };
    timers.push(entry);
    if (!tick) tick = setInterval(() => timers.forEach(renderAny), 1000);
    return { set(state) { entry.base = { ...state, receivedAt: Date.now() }; renderTimer(entry); } };
  }
  function renderTimer(e) {
    if (!e.base || !e.root) return;
    const { main, cap, t } = timeLabel(e.base);
    const time = e.root.querySelector('.time'), capEl = e.root.querySelector('.cap'), bar = e.root.querySelector('.bar');
    if (time) time.textContent = main;
    if (capEl) capEl.textContent = cap;
    if (bar) bar.setAttribute('stroke-dashoffset', String(CIRC * (1 - (e.base.currentSession ? t.left : 1))));
    const ring = e.root.classList.contains('ring') ? e.root : e.root.querySelector('.ring');
    if (ring) { ring.classList.toggle('over', t.over && !!e.base.currentSession); ring.classList.toggle('paused', e.base.status !== 'running'); }
    if (e.onTick) e.onTick({ main, cap, t, base: e.base });
  }

  // Avviso "versione demo" (attivo solo se il server ha DEMO_MODE=1)
  fetch('/api/public/config', { credentials: 'same-origin' }).then((r) => r.json()).then((c) => {
    if (!c.demo) return;
    const b = document.createElement('div');
    b.className = 'demo-banner';
    b.textContent = 'Versione demo · i dati possono essere cancellati quando il sito si riavvia';
    document.body.prepend(b);
  }).catch(() => {});

  // Euro con decimali quando servono (prezzi del food: 3,50 €)
  const price = (n) => (n == null || isNaN(n) ? '–' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: n < 100 && n % 1 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n));
  const MODULES = {
    marketReport: { label: 'Report di mercato', desc: 'Dopo ogni round i gruppi vedono grandezza del mercato, prezzo medio e quote dei concorrenti.' },
    credit: { label: 'Fido bancario e interessi', desc: 'Se la cassa va sotto zero diventa un debito che costa l\'8% di interessi a round.' },
    sourcing: { label: 'Dove produrre', desc: 'I gruppi scelgono se produrre in Italia, Europa o Asia: costo contro qualità, sostenibilità e rischio logistico.' },
    awards: { label: 'Premi speciali', desc: 'Nel debriefing: strategia più sostenibile, brand più forte, miglior rimonta, previsioni più accurate…' },
  };
  window.BG = { api, esc, eur, num, clock, $, $$, badge, codeBadge, SEG, MKT, CH, CAT, setLabels, cap, price, MODULES, makeTimer, makeRoundTimer, ringHTML };
})();
