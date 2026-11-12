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
  const SEG = { premium: 'Fashion premium', luxury: 'Luxury' };
  const MKT = { EU: 'Europa', US: 'Stati Uniti', ASIA: 'Asia' };
  const CH = { ecommerce: 'E-commerce', boutique: 'Boutique', wholesale: 'Wholesale' };

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
  function makeTimer(root, onTick) {
    const entry = { root, onTick, base: null };
    timers.push(entry);
    if (!tick) tick = setInterval(() => timers.forEach(renderTimer), 1000);
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

  window.BG = { api, esc, eur, num, clock, $, $$, badge, codeBadge, SEG, MKT, CH, makeTimer, ringHTML };
})();
