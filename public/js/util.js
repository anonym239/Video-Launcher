// Kleine Hilfsfunktionen für DOM, Formatierung und Netzwerk.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Markiert bereits sicheres HTML für das html-Template.
class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Safe(String(s ?? ''));

// html`…` – Template-Tag, das Werte automatisch escaped (außer raw()/Arrays von raw).
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return raw(out);
}

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export function frag(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup);
  return t.content;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  let t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) {
      last = now;
      fn(...a);
    } else {
      t = setTimeout(() => {
        last = Date.now();
        fn(...a);
      }, ms - (now - last));
    }
  };
}

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// 1234567 -> "1,2 Mio."
export function compact(n) {
  if (n == null || n === '' || isNaN(n)) return '';
  n = Number(n);
  if (n < 1000) return String(n);
  if (n < 1e6) return `${trim(n / 1e3)} Tsd.`;
  if (n < 1e9) return `${trim(n / 1e6)} Mio.`;
  return `${trim(n / 1e9)} Mrd.`;
}
function trim(x) {
  return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10).toLocaleString('de-DE');
}

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  const units = [
    [31536000, 'Jahr', 'Jahren'],
    [2592000, 'Monat', 'Monaten'],
    [604800, 'Woche', 'Wochen'],
    [86400, 'Tag', 'Tagen'],
    [3600, 'Stunde', 'Stunden'],
    [60, 'Minute', 'Minuten']
  ];
  for (const [s, one, many] of units) {
    const v = Math.floor(diff / s);
    if (v >= 1) return `vor ${v} ${v === 1 ? one : many}`;
  }
  return 'gerade eben';
}

export function parseTimeParam(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = String(t).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

// ---- API ---------------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const opts = { method, signal, headers: {} };
  if (method !== 'GET') {
    opts.headers['x-vl'] = '1';
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Keine Verbindung zum Server auf dem Handy. Läuft er noch?', 0);
  }
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Fehler ${res.status}`, res.status);
  return data;
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

// Bilder von YouTube-Servern: Platzhalter bei Fehlern.
export function imgFallback(e) {
  const img = e.target;
  if (img.tagName !== 'IMG' || img.dataset.failed) return;
  img.dataset.failed = '1';
  const alt = img.dataset.fallback;
  if (alt && img.src !== alt) img.src = alt;
  else img.classList.add('img-failed');
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

export const storage = {
  get(k, d) {
    try {
      const v = localStorage.getItem('vl:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('vl:' + k, JSON.stringify(v));
    } catch {}
  }
};
