// Einstiegspunkt: baut die App-Hülle (Kopfleiste, Navigation, Miniplayer) und startet das Routing.
import { route, startRouter, go, clearKeepAlive, render } from './router.js';
import { state, on, loadStatus, setAuth, signedIn, saveSettings } from './state.js';
import { api, html, raw, el, esc, debounce, $, prefetch } from './util.js';
import { icon, setCustomIcons } from './icons.js';
import { openMenu, openDialog, closeOverlay, toast, avatar, isMobile } from './components.js';
import { player } from './player.js';

// ---- Routen (gleiche Pfade wie youtube.com) -------------------------------------
route('/', () => import('./pages/home.js'), { name: 'home', keepAlive: true });
route('/results', () => import('./pages/search.js'), { name: 'search', keepAlive: true });
route('/watch', () => import('./pages/watch.js'), { name: 'watch' });
route('/shorts', () => import('./pages/shorts.js'), { name: 'shorts' });
route('/shorts/:id', () => import('./pages/shorts.js'), { name: 'shorts' });
route('/channel/:id', () => import('./pages/channel.js'), { name: 'channel', keepAlive: true });
route('/channel/:id/:tab', () => import('./pages/channel.js'), { name: 'channel', keepAlive: true });
route('/(@[^/]+)', () => import('./pages/channel.js'), { name: 'channel', keepAlive: true });
route('/(@[^/]+)/:tab', () => import('./pages/channel.js'), { name: 'channel', keepAlive: true });
route('/c/:name', () => import('./pages/resolve.js'), { name: 'resolve' });
route('/c/:name/:tab', () => import('./pages/resolve.js'), { name: 'resolve' });
route('/user/:name', () => import('./pages/resolve.js'), { name: 'resolve' });
route('/playlist', () => import('./pages/playlist.js'), { name: 'playlist' });
route('/feed/subscriptions', () => import('./pages/subscriptions.js'), { name: 'subscriptions', keepAlive: true });
route('/feed/channels', () => import('./pages/channels.js'), { name: 'channels' });
route('/feed/you', () => import('./pages/you.js'), { name: 'you' });
route('/feed/library', () => import('./pages/you.js'), { name: 'you' });
route('/feed/history', () => import('./pages/history.js'), { name: 'history' });
route('/feed/downloads', () => import('./pages/downloads.js'), { name: 'downloads' });
route('/feed/playlists', () => import('./pages/playlists.js'), { name: 'playlists' });
route('/feed/trending', () => import('./pages/explore.js'), { name: 'explore' });
route('/feed/explore', () => import('./pages/explore.js'), { name: 'explore' });
route('/hashtag/:tag', () => import('./pages/hashtag.js'), { name: 'hashtag', keepAlive: true });
route('/notifications', () => import('./pages/notifications.js'), { name: 'notifications' });
route('/settings', () => import('./pages/settings.js'), { name: 'settings' });
route('/([A-Za-z0-9_-]{11})', () => import('./pages/resolve.js'), { name: 'resolve' }); // youtu.be-Links

// ---- Kopfleiste ------------------------------------------------------------------------
const LOGO = `<svg class="logo-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#7C4DFF"/><path d="M12 1a11 11 0 0 1 11 11h-3.6A7.4 7.4 0 0 0 12 4.6z" fill="#00E5FF"/><path d="M9.4 7.2v9.6L17 12z" fill="#fff"/></svg>`;

// Name und Logo oben links – in den Einstellungen frei wählbar (bleibt auf dem Gerät).
function applyBrand() {
  const logo = icon('logo', 'logo-svg') || LOGO;
  const name = (state.settings?.brandName || '').trim() || 'YouTube';
  document.querySelectorAll('.logo-icon').forEach((n) => (n.innerHTML = logo));
  document.querySelectorAll('.logo-text').forEach((n) => (n.textContent = name));
}

function buildMasthead() {
  $('#guide-btn').innerHTML = icon('menu');
  applyBrand();
  $('#search-back').innerHTML = icon('back');
  $('.search-icon-inline').innerHTML = icon('search');
  $('#search-clear').innerHTML = icon('close');
  $('.search-btn').innerHTML = icon('search');
  $('#voice-btn').innerHTML = icon('mic');
  $('#search-toggle').innerHTML = icon('search');
  $('#notif-btn').insertAdjacentHTML('afterbegin', icon('bell'));
  $('#mh-settings').innerHTML = icon('settings');
  renderAccountButton();

  $('#guide-btn').onclick = toggleGuide;
  $('#guide-scrim').onclick = () => toggleGuide(false);
  $('#search-toggle').onclick = () => openMobileSearch(true);
  $('#search-back').onclick = () => openMobileSearch(false);
  $('#account-btn').onclick = (e) => accountMenu(e.currentTarget);
  $('#notif-btn').onclick = () => go('/notifications');
  setupSearch();
  setupVoice();
}

// "Du" in der Navigation zeigt nach der Anmeldung das Profilbild (wie in der App).
function updateYouNav() {
  const acc = state.auth.account;
  document.querySelectorAll('.pivot-item[data-name="you"], .mini-item[data-name="you"]').forEach((a) => {
    const label = a.querySelector('.pivot-label, span:last-child')?.textContent || 'Du';
    if (signedIn() && acc?.photo) a.innerHTML = `${avatar(acc.photo, 26, acc.name)}<span class="pivot-label">${label}</span>`;
    else a.innerHTML = `${icon('library', 'base-icon')}${icon('libraryFilled', 'when-active')}<span class="pivot-label">${label}</span>`;
  });
}

function renderAccountButton() {
  updateYouNav();
  const b = $('#account-btn');
  const acc = state.auth.account;
  if (signedIn()) {
    b.innerHTML = String(avatar(acc?.photo, 32, acc?.name || 'G'));
    b.classList.remove('sign-in');
    $('#notif-btn').hidden = false;
    refreshNotifCount();
  } else {
    b.innerHTML = isMobile() ? icon('account') : `${icon('account')}<span>Anmelden</span>`;
    b.classList.add('sign-in');
    $('#notif-btn').hidden = true;
  }
}

async function refreshNotifCount() {
  try {
    const { count } = await api('/api/notifications/count');
    const badge = $('#notif-badge');
    badge.hidden = !count;
    badge.textContent = count > 9 ? '9+' : String(count);
    const pb = document.querySelector('.pivot-badge');
    if (pb) {
      pb.hidden = !count;
      pb.textContent = count > 9 ? '9+' : String(count);
    }
  } catch {}
}

function openMobileSearch(open) {
  document.body.classList.toggle('mobile-search', open);
  if (open) {
    const input = $('#search-input');
    input.focus();
    showSuggestions(input.value);
  } else {
    hideSuggestions();
  }
}

// ---- Suche mit Vorschlägen -----------------------------------------------------------
let suggestCtl = null;
let activeSuggestion = -1;

function setupSearch() {
  const form = $('#search-form');
  const input = $('#search-input');
  const clear = $('#search-clear');
  const fetchSuggestions = debounce((q) => showSuggestions(q), 150);

  input.addEventListener('input', () => {
    clear.classList.toggle('visible', !!input.value);
    activeSuggestion = -1;
    fetchSuggestions(input.value);
  });
  input.addEventListener('focus', () => {
    form.classList.add('focused');
    showSuggestions(input.value);
  });
  input.addEventListener('blur', () => {
    form.classList.remove('focused');
    setTimeout(hideSuggestions, 180);
  });
  input.addEventListener('keydown', (e) => {
    const items = [...document.querySelectorAll('#suggestions li')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const n = items.length;
      if (e.key === 'ArrowDown') activeSuggestion = activeSuggestion + 1 >= n ? -1 : activeSuggestion + 1;
      else activeSuggestion = activeSuggestion - 1 < -1 ? n - 1 : activeSuggestion - 1;
      items.forEach((li, i) => li.classList.toggle('active', i === activeSuggestion));
      if (activeSuggestion >= 0) input.value = items[activeSuggestion].dataset.q;
    } else if (e.key === 'Escape') {
      hideSuggestions();
      input.blur();
    }
  });
  clear.addEventListener('mousedown', (e) => e.preventDefault());
  clear.onclick = () => {
    input.value = '';
    clear.classList.remove('visible');
    input.focus();
    showSuggestions('');
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSearch(input.value);
  });
}

function submitSearch(q) {
  q = q.trim();
  if (!q) return;
  hideSuggestions();
  $('#search-input').blur();
  document.body.classList.remove('mobile-search');
  // Direkt eingefügte YouTube-Links öffnen.
  const link = parseYouTubeLink(q);
  if (link) return go(link);
  go(`/results?search_query=${encodeURIComponent(q)}`);
}

export function parseYouTubeLink(q) {
  q = q.trim();
  // Auch Links ohne „https://“ erkennen (z. B. „youtube.com/watch?v=…“).
  if (/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(q)) q = `https://${q}`;
  try {
    const u = new URL(q);
    const host = u.hostname.toLowerCase();
    const t = u.searchParams.get('t');
    const watch = (id) => `/watch?v=${encodeURIComponent(id)}${t ? `&t=${encodeURIComponent(t)}` : ''}`;
    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1];
      return id ? watch(id) : null;
    }
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      // /live/ID, /embed/ID, /v/ID → normale Wiedergabeseite
      const m = u.pathname.match(/^\/(?:live|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return watch(m[1]);
      return u.pathname + u.search;
    }
  } catch {}
  return null;
}

async function showSuggestions(q) {
  const list = $('#suggestions');
  suggestCtl?.abort();
  suggestCtl = new AbortController();
  let data;
  try {
    data = await api(`/api/suggest?q=${encodeURIComponent(q.trim())}`, { signal: suggestCtl.signal });
  } catch {
    return;
  }
  const input = $('#search-input');
  if (document.activeElement !== input) return;
  list.innerHTML = '';
  for (const s of data.suggestions || []) {
    const li = el(html`<li role="option" data-q="${s.text}" class="${s.history ? 'history' : ''}">${raw(icon(s.history ? 'history' : 'search'))}<span>${highlight(s.text, q)}</span>${s.history ? html`<button class="sugg-remove" aria-label="Entfernen">Entfernen</button>` : ''}<button type="button" class="icon-btn sugg-fill" aria-label="In Suchfeld übernehmen">${raw(icon('northWest'))}</button></li>`);
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', async (e) => {
      if (e.target.closest('.sugg-remove')) {
        await api(`/api/suggest?q=${encodeURIComponent(s.text)}`, { method: 'DELETE' }).catch(() => {});
        li.remove();
        return;
      }
      if (e.target.closest('.sugg-fill')) {
        input.value = s.text + ' ';
        $('#search-clear').classList.add('visible');
        input.focus();
        showSuggestions(input.value);
        return;
      }
      input.value = s.text;
      submitSearch(s.text);
    });
    list.appendChild(li);
  }
  list.hidden = !list.children.length;
}

function highlight(text, q) {
  q = q.trim().toLowerCase();
  if (q && text.toLowerCase().startsWith(q)) return raw(`${esc(text.slice(0, q.length))}<b>${esc(text.slice(q.length))}</b>`);
  return text;
}

function hideSuggestions() {
  $('#suggestions').hidden = true;
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#voice-btn');
  if (!SR) {
    btn.hidden = true;
    return;
  }
  btn.onclick = () => {
    const rec = new SR();
    rec.lang = state.settings.lang === 'en' ? 'en-US' : 'de-DE';
    rec.interimResults = true;
    const body = el(`<div class="voice"><div class="voice-mic">${icon('mic')}</div><p class="voice-text">Sprich jetzt…</p></div>`);
    openDialog({ title: 'Sprachsuche', body, onClose: () => rec.abort() });
    rec.onresult = (e) => {
      const t = [...e.results].map((r) => r[0].transcript).join('');
      body.querySelector('.voice-text').textContent = t;
      if (e.results[e.results.length - 1].isFinal) {
        closeOverlay();
        $('#search-input').value = t;
        submitSearch(t);
      }
    };
    rec.onerror = () => {
      body.querySelector('.voice-text').textContent = 'Spracherkennung nicht verfügbar.';
    };
    rec.start();
  };
}

// ---- Navigation (Seitenleiste & untere Leiste) -------------------------------------
const NAV = [
  { href: '/', label: 'Startseite', icon: 'home', active: 'homeFilled', name: 'home' },
  { href: '/shorts', label: 'Shorts', icon: 'shorts', active: 'shortsFilled', name: 'shorts' },
  { href: '/feed/subscriptions', label: 'Abos', icon: 'subs', active: 'subsFilled', name: 'subscriptions' }
];

function buildGuide() {
  const g = $('#guide');
  const you = [
    { href: '/feed/history', label: 'Verlauf', icon: 'history', name: 'history' },
    { href: '/feed/playlists', label: 'Playlists', icon: 'playlist', name: 'playlists' },
    { href: '/playlist?list=WL', label: 'Später ansehen', icon: 'clock' },
    { href: '/playlist?list=LL', label: 'Videos mit „Mag ich“', icon: 'like' },
    { href: '/feed/downloads', label: 'Downloads', icon: 'download', name: 'downloads' }
  ];
  const explore = [
    { href: '/feed/trending', label: 'Trends', icon: 'trending', name: 'explore' },
    { href: '/results?search_query=Musik', label: 'Musik', icon: 'music' },
    { href: '/results?search_query=Gaming', label: 'Gaming', icon: 'gaming' },
    { href: '/results?search_query=Nachrichten', label: 'Nachrichten', icon: 'news' },
    { href: '/results?search_query=Sport', label: 'Sport', icon: 'sports' },
    { href: '/results?search_query=live&features=live', label: 'Live', icon: 'live' }
  ];
  const link = (n) => html`<a class="guide-item" href="${n.href}" data-name="${n.name || ''}" data-href="${n.href}">${raw(icon(n.icon, n.active ? 'base-icon' : ''))}${n.active ? raw(icon(n.active, 'when-active')) : ''}<span>${n.label}</span></a>`;
  g.innerHTML = html`
    <div class="guide-head"><button class="icon-btn guide-close" aria-label="Navigation schließen">${raw(icon('menu'))}</button><a href="/" class="logo">${raw(`<span class="logo-icon">${LOGO}</span>`)}<span class="logo-text">Video Launcher</span></a></div>
    <div class="guide-section">${NAV.map(link)}</div>
    <div class="guide-section"><a class="guide-title" href="/feed/you">Du ${raw(icon('right'))}</a>${you.map(link)}</div>
    <div class="guide-section guide-subs"><h3 class="guide-title"><a href="/feed/channels">Abos</a></h3><div class="guide-subs-list"></div></div>
    <div class="guide-section"><h3 class="guide-title">Entdecken</h3>${explore.map(link)}</div>
    <div class="guide-section">${link({ href: '/settings', label: 'Einstellungen', icon: 'settings', name: 'settings' })}</div>
    <footer class="guide-footer">Ohne Werbung · ohne API-Key · läuft auf deinem Handy.<br>Inhalte © ihre jeweiligen Urheber.</footer>
  `.toString();
  g.querySelector('.guide-close').onclick = () => toggleGuide(false);
  g.addEventListener('click', (e) => {
    if (e.target.closest('a') && !isWide()) toggleGuide(false);
  });

  $('#mini-guide').innerHTML = [...NAV, { href: '/feed/you', label: 'Du', icon: 'library', active: 'libraryFilled', name: 'you' }]
    .map((n) => html`<a class="mini-item" href="${n.href}" data-name="${n.name}">${raw(icon(n.icon, 'base-icon'))}${raw(icon(n.active, 'when-active'))}<span>${n.label}</span></a>`)
    .join('');

  // Untere Leiste wie in der YouTube-App – Shorts bleibt drin.
  $('#pivot-bar').innerHTML = [
    ...NAV,
    { href: '/notifications', label: 'Benachrichtigungen', icon: 'bell', active: 'bellFilled', name: 'notifications' },
    { href: '/feed/you', label: 'Mein YouTube', icon: 'library', active: 'libraryFilled', name: 'you' }
  ]
    .map((n) => html`<a class="pivot-item" href="${n.href}" data-name="${n.name}" aria-label="${n.label}">${raw(icon(n.icon, 'base-icon'))}${raw(icon(n.active, 'when-active'))}${n.name === 'notifications' ? raw('<span class="pivot-label pl-long">Benachrichtigungen</span><span class="pivot-label pl-short">Mitteilungen</span><span class="pivot-badge" hidden></span>') : html`<span class="pivot-label">${n.label}</span>`}</a>`)
    .join('');
  loadGuideSubs();
}

export async function loadGuideSubs() {
  const box = $('.guide-subs-list');
  if (!box) return;
  try {
    const { items } = await api('/api/subscriptions');
    state.subs = new Set(items.map((c) => c.id));
    box.innerHTML = '';
    const show = items.slice(0, 7);
    for (const c of show) {
      box.appendChild(el(html`<a class="guide-item" href="/channel/${c.id}">${avatar(c.avatar, 24, c.name)}<span>${c.name}</span></a>`));
    }
    if (items.length > 7) box.appendChild(el(html`<a class="guide-item" href="/feed/channels">${raw(icon('down'))}<span>${items.length - 7} weitere anzeigen</span></a>`));
    if (!items.length) box.appendChild(el('<p class="guide-hint">Abonniere Kanäle, um ihre neuesten Videos hier zu sehen.</p>'));
  } catch {
    box.innerHTML = '';
  }
}

const isWide = () => matchMedia('(min-width: 1312px)').matches;

function toggleGuide(force) {
  if (isWide() && document.body.dataset.page !== 'watch') {
    const collapsed = force === undefined ? !document.body.classList.contains('guide-collapsed') : !force;
    document.body.classList.toggle('guide-collapsed', collapsed);
    localStorage.setItem('vl:guideCollapsed', collapsed ? '1' : '0');
    return;
  }
  const open = force ?? !document.body.classList.contains('guide-open');
  document.body.classList.toggle('guide-open', open);
  $('#guide-scrim').hidden = !open;
}

function markActiveNav(path, name) {
  const full = location.pathname + location.search;
  document.querySelectorAll('[data-name], .guide-item[data-href]').forEach((a) => {
    const active = (a.dataset.name && a.dataset.name === name) || (a.dataset.href && a.dataset.href === full && !a.dataset.name);
    a.classList.toggle('active', !!active);
  });
}

// ---- Konto & Anmeldung ---------------------------------------------------------------
function accountMenu(anchor) {
  if (!signedIn()) {
    loginDialog();
    return;
  }
  const acc = state.auth.account || {};
  const items = [
    { icon: 'accountBox', label: `${acc.name || 'Google-Konto'}${acc.handle ? ` (${acc.handle})` : ''}`, run: () => acc.channelId && go(`/channel/${acc.channelId}`) },
    { divider: true },
    { icon: 'library', label: 'Du', run: () => go('/feed/you') },
    { icon: 'history', label: 'Verlauf', run: () => go('/feed/history') },
    { icon: 'theme', label: `Design: ${state.settings.theme === 'light' ? 'Hell' : state.settings.theme === 'system' ? 'Gerätedesign' : 'Dunkel'}`, run: () => themeMenu(anchor) },
    { icon: 'settings', label: 'Einstellungen', run: () => go('/settings') },
    { divider: true },
    { icon: 'logout', label: 'Abmelden', run: logout }
  ];
  openMenu(anchor, items);
}

export function themeMenu(anchor) {
  const cur = state.settings.theme;
  openMenu(anchor, [
    { label: 'Gerätedesign verwenden', check: cur === 'system', run: () => saveSettings({ theme: 'system' }) },
    { label: 'Dunkles Design', check: cur === 'dark', run: () => saveSettings({ theme: 'dark' }) },
    { label: 'Helles Design', check: cur === 'light', run: () => saveSettings({ theme: 'light' }) }
  ]);
}

async function logout() {
  try {
    setAuth(await api('/api/auth/logout', { method: 'POST' }));
    toast('Abgemeldet');
  } catch (e) {
    toast(e.message);
  }
}

const G_LOGO = '<svg viewBox="0 0 48 48" class="g-logo" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

// Anmeldung: In der Android-App öffnet „Mit Google anmelden“ die offizielle
// Google-Anmeldeseite (LoginActivity) und übergibt danach die YouTube-Sitzung an den
// Server. Im Browser (z. B. Termux) bleibt die Anmeldung mit Browser-Cookies.
// (Die frühere Geräte-Code-Anmeldung über google.com/device lässt YouTube nicht mehr zu.)
const hasNativeLogin = () => typeof window.VLAndroid?.googleLogin === 'function';

function loginBody({ onDone }) {
  const native = hasNativeLogin();
  const body = el(html`<div class="login">
    <div class="login-hero">${raw(LOGO)}<h2>Anmelden, um fortzufahren</h2><p>Melde dich mit deinem Google-Konto an, um Video Launcher zu nutzen: Abos, Playlists, „Mag ich“, Verlauf und Empfehlungen – ohne Werbung.</p></div>
    <div class="login-step login-start">
      ${native ? html`<button class="btn btn-google">${raw(G_LOGO)}<span>Mit Google anmelden</span></button>
      <p class="muted small">Du meldest dich direkt auf der offiziellen Google-Seite an. Dein Passwort wird nie an diese App gegeben – auf dem Handy wird nur die YouTube-Sitzung gespeichert.</p>` : ''}
    </div>
    <div class="login-step login-wait-step" hidden><div class="login-wait"><div class="spinner"></div><span>Anmeldung wird abgeschlossen…</span></div></div>
    <details class="login-cookie" ${native ? '' : raw('open')}>
      <summary>${native ? 'Alternative: Mit Browser-Cookies anmelden' : 'Mit Browser-Cookies anmelden'}</summary>
      <p class="muted small">Melde dich in einem Browser auf youtube.com an, kopiere den kompletten <code>Cookie</code>-Header einer Anfrage (Entwicklertools → Netzwerk) und füge ihn hier ein. Die Cookies bleiben nur auf deinem Gerät.</p>
      <textarea class="cookie-input" rows="4" placeholder="SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; …"></textarea>
      <button class="btn btn-blue cookie-save">Mit Cookies anmelden</button>
    </details>
  </div>`);
  const showStep = (name) => body.querySelectorAll('.login-step').forEach((x) => (x.hidden = !x.classList.contains(name)));
  const finish = async () => {
    try {
      const a = await api('/api/auth/status');
      if (a.status === 'signed_in') {
        setAuth(a);
        toast('Angemeldet' + (a.account?.name ? ` als ${a.account.name}` : ''));
        onDone?.();
        return;
      }
    } catch {}
    showStep('login-start');
  };
  const btn = body.querySelector('.btn-google');
  if (btn) {
    btn.onclick = () => {
      const handler = (e) => {
        window.removeEventListener('vl-login-done', handler);
        if (e.detail) {
          showStep('login-wait-step');
          finish();
        }
      };
      window.addEventListener('vl-login-done', handler);
      window.VLAndroid.googleLogin();
    };
  }
  body.querySelector('.cookie-save').onclick = async () => {
    try {
      const a = await api('/api/auth/cookie', { method: 'POST', body: { cookie: body.querySelector('.cookie-input').value } });
      setAuth(a);
      toast('Angemeldet');
      onDone?.();
    } catch (e) {
      toast(e.message);
    }
  };
  return body;
}

export function loginDialog() {
  if (!signedIn()) return showLoginGate();
  openDialog({ title: 'Anmelden', body: loginBody({ onDone: () => closeOverlay() }), className: 'login-dialog' });
}

// Ohne Anmeldung geht nichts: bildschirmfüllende Anmeldeseite.
function showLoginGate() {
  if (signedIn()) return hideLoginGate();
  if (document.querySelector('.login-gate')) return;
  player.video?.pause();
  const gate = el('<div class="login-gate" role="dialog" aria-modal="true" aria-label="Anmelden"></div>');
  gate.appendChild(loginBody({ onDone: hideLoginGate }));
  document.body.appendChild(gate);
  document.body.classList.add('gated');
}

function hideLoginGate() {
  document.querySelector('.login-gate')?.remove();
  document.body.classList.remove('gated');
}

// ---- Miniplayer --------------------------------------------------------------------------
export const mini = {
  active: false,
  info: null,
  show(info) {
    const box = $('#miniplayer');
    box.hidden = false;
    box.appendChild(player.root);
    player.setMode('mini');
    this.active = true;
    this.info = info;
    document.body.classList.add('has-mini');
    player.setHooks({
      ...player.hooks,
      onClose: () => this.close(),
      onExpand: () => this.expand()
    });
  },
  expand() {
    if (!this.info) return;
    go(this.info.url);
  },
  close() {
    player.stop();
    this.hide();
  },
  hide() {
    const box = $('#miniplayer');
    box.hidden = true;
    $('#player-host').appendChild(player.root);
    player.setMode('full');
    this.active = false;
    this.info = null;
    document.body.classList.remove('has-mini');
  }
};

// ---- Hinweis beim ersten Start ----------------------------------------------------------
function showFirstRunNotice() {
  if (localStorage.getItem('vl:noticeAccepted') === '1') return;
  openDialog({
    title: 'Willkommen bei Video Launcher',
    body: html`<div class="notice">
      <p>Video Launcher ist ein <b>unabhängiges Open-Source-Projekt</b>. Es ist nicht mit YouTube oder Google verbunden und wird von ihnen weder unterstützt noch geprüft.</p>
      <p>Die App läuft nur auf deinem Gerät: Inhalte werden direkt von den öffentlichen Servern abgerufen. Es gibt keinen zentralen Server, und die App speichert oder verbreitet keine Videos anderer.</p>
      <p>Bitte beachte die Rechte der Urheber und nutze die App nur privat und auf eigene Verantwortung.</p>
    </div>`,
    actions: [{ label: 'Verstanden', primary: true, run: () => localStorage.setItem('vl:noticeAccepted', '1') }],
    className: 'notice-dialog'
  });
}

// ---- Start ----------------------------------------------------------------------------------
async function boot() {
  // Eigene Symbole zuerst (aus dem Zwischenspeicher sofort, vom Server aktualisiert).
  api('/api/custom-icons')
    .then((m) => {
      const before = localStorage.getItem('vl:customIcons') || '{}';
      setCustomIcons(m);
      if (JSON.stringify(m) !== before) location.reload();
    })
    .catch(() => {});
  buildMasthead();
  buildGuide();
  $('#player-host').appendChild(player.root);
  if (localStorage.getItem('vl:guideCollapsed') === '1') document.body.classList.add('guide-collapsed');

  on('navigate', ({ path, name }) => {
    markActiveNav(path, name);
    document.body.classList.remove('guide-open', 'mobile-search');
    $('#guide-scrim').hidden = true;
    closeOverlay();
    const q = new URLSearchParams(location.search).get('search_query');
    if (name === 'search' && q != null) $('#search-input').value = q;
    else if (name !== 'search') $('#search-input').value = '';
    $('#search-clear').classList.toggle('visible', !!$('#search-input').value);
  });
  on('auth', () => {
    renderAccountButton();
    loadGuideSubs();
    clearKeepAlive();
    if (document.body.dataset.page && document.body.dataset.page !== 'watch' && document.body.dataset.page !== 'shorts') render(false);
  });
  on('player:mini', () => {
    if (document.body.dataset.page === 'watch') go('/');
  });

  // Schon beim Berühren eines Videos Infos und Streams laden – spart beim Öffnen Zeit.
  document.addEventListener('pointerdown', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const watch = href.match(/^\/watch\?v=([\w-]{11})(?:&|$)/);
    const short = href.match(/^\/shorts\/([\w-]{11})/);
    if (watch) {
      if (!href.includes('list=')) prefetch(`/api/video/${watch[1]}`);
      prefetch(`/api/streams/${watch[1]}`);
    } else if (short) {
      prefetch(`/api/streams/${short[1]}`);
    }
  }, { passive: true, capture: true });

  // Globale Tastenkürzel: "/" fokussiert die Suche.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.closest?.('input, textarea, select, [contenteditable="true"]');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      if (isMobile()) openMobileSearch(true);
      else $('#search-input').focus();
      return;
    }
    if (typing) return;
    if (mini.active || document.body.dataset.page === 'watch') {
      if (player.meta && player.handleKey(e)) e.preventDefault();
    }
  });

  window.addEventListener('resize', debounce(renderAccountButton, 200));
  // Zoom-Gesten sperren (Safari/ältere WebViews ignorieren user-scalable=no).
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  try {
    await loadStatus();
  } catch (e) {
    toast(e.message);
  }
  renderAccountButton();
  applyBrand();
  on('settings', applyBrand);
  setInterval(() => signedIn() && refreshNotifCount(), 5 * 60 * 1000);
  on('auth', () => (signedIn() ? hideLoginGate() : showLoginGate()));
  if (!signedIn()) showLoginGate();
  startRouter();
  // Erst nach dem ersten Rendern zeigen, sonst schließt die Navigation den Dialog sofort.
  showFirstRunNotice();
}

boot();
