// Clientseitiges Routing mit denselben Pfaden wie youtube.com
// (/watch?v=…, /shorts/…, /@kanal, /playlist?list=… usw.).
import { emit } from './state.js';

const routes = [];
let current = null; // { page, cleanup, url, node, keepAlive }
let navId = 0;
const keepAlive = new Map(); // url -> { node, scroll, page }
const KEEP_MAX = 6;

export function route(pattern, loader, opts = {}) {
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, n) => (names.push(n), '([^/]+)')) + '/?$');
  routes.push({ re, names, loader, opts });
}

function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (m) {
      const params = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] || '')));
      return { ...r, params };
    }
  }
  return null;
}

export function currentUrl() {
  return location.pathname + location.search;
}

export function go(url, { replace = false } = {}) {
  const u = new URL(url, location.origin);
  if (u.origin !== location.origin) {
    window.open(u.href, '_blank', 'noopener');
    return;
  }
  const next = u.pathname + u.search + u.hash;
  if (next === currentUrl() + location.hash && !replace) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    emit('reselect', next);
    return;
  }
  saveScroll();
  if (replace) history.replaceState({ key: Date.now() }, '', next);
  else history.pushState({ key: Date.now() }, '', next);
  render(false);
}

function saveScroll() {
  const st = history.state || {};
  history.replaceState({ ...st, scroll: window.scrollY }, '', currentUrl() + location.hash);
}

export async function render(isPop) {
  const app = document.getElementById('app');
  const url = currentUrl();
  const id = ++navId;
  const m = match(location.pathname);

  // Alte Seite aufräumen oder für "Zurück" aufbewahren.
  if (current) {
    if (current.keepAlive && current.node) {
      keepAlive.set(current.url, { node: current.node, page: current, scroll: window.scrollY });
      if (keepAlive.size > KEEP_MAX) {
        const [oldUrl, old] = keepAlive.entries().next().value;
        keepAlive.delete(oldUrl);
        old.page.cleanup?.();
      }
    } else {
      try {
        current.cleanup?.();
      } catch (e) {
        console.error(e);
      }
    }
    current.node?.remove();
    current = null;
  }

  emit('navigate', { url, path: location.pathname, name: m?.opts.name || '' });
  document.body.dataset.page = m?.opts.name || 'notfound';

  if (isPop && keepAlive.has(url)) {
    const k = keepAlive.get(url);
    keepAlive.delete(url);
    app.appendChild(k.node);
    current = k.page;
    current.node = k.node;
    requestAnimationFrame(() => window.scrollTo(0, history.state?.scroll ?? k.scroll ?? 0));
    current.onResume?.();
    return;
  }

  if (keepAlive.has(url)) {
    keepAlive.get(url).page.cleanup?.();
    keepAlive.delete(url);
  }

  const node = document.createElement('div');
  node.className = 'page page-' + (m?.opts.name || 'notfound');
  app.appendChild(node);
  current = { url, node, keepAlive: !!m?.opts.keepAlive, cleanup: null };
  if (!isPop) window.scrollTo(0, 0);

  if (!m) {
    node.innerHTML = '<div class="empty-state"><h2>Diese Seite gibt es nicht.</h2><p><a href="/">Zur Startseite</a></p></div>';
    return;
  }
  try {
    const mod = await m.loader();
    if (id !== navId) return;
    const ctl = new AbortController();
    const query = new URLSearchParams(location.search);
    const res = await mod.default({ node, params: m.params, query, signal: ctl.signal, url });
    const entry = current;
    if (id !== navId) {
      ctl.abort();
      if (typeof res === 'function') res();
      else res?.cleanup?.();
      return;
    }
    entry.cleanup = () => {
      ctl.abort();
      if (typeof res === 'function') res();
      else res?.cleanup?.();
    };
    if (res && typeof res === 'object') entry.onResume = res.onResume;
    if (isPop && history.state?.scroll) requestAnimationFrame(() => window.scrollTo(0, history.state.scroll));
  } catch (e) {
    if (id !== navId || e.name === 'AbortError') return;
    console.error(e);
    node.innerHTML = `<div class="empty-state error-state"><h2>Etwas ist schiefgelaufen</h2><p></p><button class="btn btn-filled" data-retry>Erneut versuchen</button></div>`;
    node.querySelector('p').textContent = e.message || String(e);
    node.querySelector('[data-retry]').onclick = () => render(false);
  }
}

// Seiten-Cache leeren (z. B. nach Anmeldung, damit Inhalte neu geladen werden).
export function clearKeepAlive() {
  for (const k of keepAlive.values()) k.page.cleanup?.();
  keepAlive.clear();
}

export function startRouter() {
  window.addEventListener('popstate', () => render(true));
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/') || href.startsWith('/vp') || href.startsWith('/dl/')) return;
    e.preventDefault();
    go(href);
  });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  render(true);
}
