// Wiederverwendbare UI-Bausteine im YouTube-Stil.
import { html, raw, el, esc, api, copyText, formatTime, imgFallback } from './util.js';
import { icon } from './icons.js';
import { state, signedIn, progressOf, hideVideo, blockChannel, isFiltered } from './state.js';

// ---- Allgemein --------------------------------------------------------------
export const isMobile = () => matchMedia('(max-width: 791px)').matches;

document.addEventListener('error', imgFallback, true);

export function avatar(src, size = 36, name = '') {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  if (!src) return html`<span class="avatar avatar-letter" style="--s:${size}px" aria-hidden="true">${letter}</span>`;
  return html`<img class="avatar" style="--s:${size}px" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
}

const verified = (v) => (v ? raw(`<span class="verified" title="Bestätigt">${icon('verified')}</span>`) : '');

function channelLink(ch) {
  if (!ch) return '';
  if (ch.id) return `/channel/${ch.id}`;
  return '';
}

// Kleine WebP-Vorschaubilder (statt großer JPGs) – der Browser wählt die passende Größe.
const YT_ID = /^[\w-]{11}$/;
let eagerImages = 4; // die ersten Bilder sofort laden, den Rest erst beim Scrollen
function thumbImg(item) {
  const lazy = eagerImages-- > 0 ? raw('fetchpriority="high"') : raw('loading="lazy"');
  if (!YT_ID.test(item.id || '')) return html`<img src="${item.thumbnail}" alt="" ${lazy} decoding="async">`;
  const b = `https://i.ytimg.com/vi_webp/${item.id}/`;
  return html`<img src="${b}mqdefault.webp" srcset="${b}mqdefault.webp 320w, ${b}hqdefault.webp 480w, ${b}sddefault.webp 640w" sizes="(max-width: 791px) 60vw, 360px" alt="" ${lazy} decoding="async" data-fallback="https://i.ytimg.com/vi/${item.id}/mqdefault.jpg">`;
}

function videoHref(item, extra = '') {
  const t = item.listId ? `&list=${encodeURIComponent(item.listId)}${item.index ? `&index=${encodeURIComponent(item.index)}` : ''}` : '';
  return `/watch?v=${item.id}${t}${extra}`;
}

function thumbBadge(item) {
  if (item.live) return html`<span class="thumb-badge live">${raw(icon('live'))} LIVE</span>`;
  if (item.upcoming) return html`<span class="thumb-badge">BALD VERFÜGBAR</span>`;
  if (item.duration) return html`<span class="thumb-badge">${item.duration}</span>`;
  return '';
}

function progressBar(item) {
  const p = progressOf(item.id, item.durationSec);
  return p > 1 ? html`<div class="thumb-progress"><div style="width:${p.toFixed(1)}%"></div></div>` : '';
}

function metaLine(item) {
  const parts = [item.views, item.published].filter(Boolean);
  return parts.join(' • ');
}

// ---- Video-Karten -------------------------------------------------------------
// variant: grid (Startseite), list (Suche), compact (Seitenleiste), playlist
export function videoCard(item, variant = 'grid') {
  const href = videoHref(item);
  const ch = item.channel;
  const chHref = channelLink(ch);
  const card = el(html`
    <div class="video-card v-${variant}" data-id="${item.id}">
      <a class="thumb" href="${href}" tabindex="-1" aria-hidden="true">
        ${thumbImg(item)}
        ${thumbBadge(item)}
        ${progressBar(item)}
      </a>
      <div class="vc-details">
        ${variant === 'grid' && ch ? html`<a class="vc-avatar" href="${chHref || '#'}" aria-label="${ch.name}">${avatar(ch.avatar, 36, ch.name)}</a>` : ''}
        <div class="vc-text">
          <h3 class="vc-title"><a href="${href}" title="${item.title}">${item.title}</a></h3>
          <div class="vc-meta">
            ${variant === 'list' && ch ? html`<a class="vc-channel with-avatar" href="${chHref || '#'}">${avatar(ch.avatar, 24, ch.name)}<span>${ch.name}</span>${verified(ch.verified)}</a>` : ''}
            ${variant !== 'list' && ch?.name ? html`<a class="vc-channel" href="${chHref || '#'}">${ch.name}${verified(ch.verified)}</a>` : ''}
            ${metaLine(item) ? html`<span class="vc-stats">${metaLine(item)}</span>` : ''}
          </div>
          ${variant === 'list' && item.description ? html`<p class="vc-desc">${item.description}</p>` : ''}
          ${item.live ? html`<span class="badge-live">${raw(icon('live'))} LIVE</span>` : ''}
        </div>
        <button class="icon-btn vc-menu" aria-label="Aktionsmenü">${raw(icon('more'))}</button>
      </div>
    </div>`);
  card.querySelector('.vc-menu').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    videoMenu(item, e.currentTarget, card);
  });
  if (!chHref) card.querySelectorAll('a.vc-channel, a.vc-avatar').forEach((a) => a.removeAttribute('href'));
  return card;
}

export function shortCard(item, variant = 'grid') {
  const card = el(html`
    <div class="short-card s-${variant}" data-id="${item.id}">
      <a class="short-thumb" href="/shorts/${item.id}">
        <img src="${item.thumbnail}" alt="" loading="lazy" decoding="async" data-fallback="https://i.ytimg.com/vi/${item.id}/hq2.jpg">
      </a>
      <div class="short-info">
        <h3 class="short-title"><a href="/shorts/${item.id}">${item.title}</a></h3>
        ${item.views ? html`<div class="short-views">${item.views}</div>` : ''}
      </div>
      <button class="icon-btn short-menu" aria-label="Aktionsmenü">${raw(icon('more'))}</button>
    </div>`);
  card.querySelector('.short-menu').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    videoMenu({ ...item, short: true }, e.currentTarget, card);
  });
  return card;
}

export function channelCard(item, variant = 'list') {
  const href = item.id ? `/channel/${item.id}` : '#';
  const card = el(html`
    <div class="channel-card c-${variant}">
      <a class="cc-avatar" href="${href}">${avatar(item.avatar, variant === 'grid' ? 104 : 136, item.name)}</a>
      <div class="cc-text">
        <h3 class="cc-name"><a href="${href}">${item.name}</a>${verified(item.verified)}</h3>
        <div class="cc-meta">${[item.handle, item.subscribers, item.videos].filter(Boolean).join(' • ')}</div>
        ${item.description ? html`<p class="cc-desc">${item.description}</p>` : ''}
      </div>
      <div class="cc-action"></div>
    </div>`);
  if (item.id) card.querySelector('.cc-action').appendChild(subscribeButton({ id: item.id, name: item.name, avatar: item.avatar }, null));
  return card;
}

export function playlistCard(item, variant = 'grid') {
  const href = item.firstVideoId && !item.local ? `/watch?v=${item.firstVideoId}&list=${item.id}` : `/playlist?list=${encodeURIComponent(item.id)}`;
  const card = el(html`
    <div class="playlist-card p-${variant}">
      <a class="thumb pl-thumb" href="${href}">
        ${item.thumbnail ? html`<img src="${item.thumbnail}" alt="" loading="lazy">` : html`<div class="thumb-empty">${raw(icon('playlist'))}</div>`}
        <span class="thumb-badge pl-count">${raw(icon(item.mix ? 'live' : 'playlist'))} ${item.count || (item.mix ? 'Mix' : '')}</span>
        <span class="pl-hover">${raw(icon('play'))} Alle wiedergeben</span>
      </a>
      <div class="vc-text">
        <h3 class="vc-title"><a href="${href}">${item.title}</a></h3>
        <div class="vc-meta">
          ${item.channel?.name ? html`<span>${item.channel.name}</span>` : ''}
          ${item.meta ? html`<span>${item.meta}</span>` : ''}
          <a class="vc-link" href="/playlist?list=${encodeURIComponent(item.id)}">Vollständige Playlist ansehen</a>
        </div>
      </div>
    </div>`);
  return card;
}

export function postCard(item) {
  const ch = item.channel || {};
  const card = el(html`
    <article class="post-card">
      <a href="/channel/${ch.id || ''}">${avatar(ch.avatar, 40, ch.name)}</a>
      <div class="post-body">
        <div class="post-head"><a href="/channel/${ch.id || ''}" class="post-author">${ch.name}</a> <span class="post-time">${item.published}</span></div>
        <div class="post-content">${raw(item.content)}</div>
        ${item.images?.length ? html`<div class="post-images ${item.images.length > 1 ? 'multi' : ''}">${item.images.map((src) => html`<img src="${src}" alt="" loading="lazy">`)}</div>` : ''}
        ${item.poll ? html`<div class="post-poll">${item.poll.choices.map((c) => html`<div class="poll-choice">${c}</div>`)}<div class="poll-total">${item.poll.total}</div></div>` : ''}
        <div class="post-video"></div>
        <div class="post-actions"><span class="post-like">${raw(icon('like'))} ${item.likes}</span></div>
      </div>
    </article>`);
  if (item.video) card.querySelector('.post-video').appendChild(videoCard(item.video, 'list'));
  return card;
}

export function shelf(item, layout) {
  const node = el(html`<section class="shelf ${item.shorts ? 'shelf-shorts' : ''}">
      ${item.title || item.shorts ? html`<h2 class="shelf-title">${item.shorts ? raw(icon('shortsFilled', 'shorts-red')) : ''}${item.title || 'Shorts'}</h2>` : ''}
      <div class="shelf-items ${item.shorts ? 'shorts-row' : ''}"></div>
      ${item.items.length > 6 && !item.shorts ? html`<button class="btn btn-text shelf-more">Mehr anzeigen ${raw(icon('down'))}</button>` : ''}
    </section>`);
  const box = node.querySelector('.shelf-items');
  const items = item.items.filter((i) => !isFiltered(i));
  if (item.shorts) {
    items.forEach((s) => box.appendChild(shortCard(s, 'shelf')));
    if (box.children.length > 2) {
      const prev = el(`<button class="scroll-btn prev" aria-label="Zurück">${icon('left')}</button>`);
      const next = el(`<button class="scroll-btn next" aria-label="Weiter">${icon('right')}</button>`);
      prev.onclick = () => box.scrollBy({ left: -box.clientWidth * 0.8, behavior: 'smooth' });
      next.onclick = () => box.scrollBy({ left: box.clientWidth * 0.8, behavior: 'smooth' });
      node.append(prev, next);
    }
  } else {
    box.classList.add(layout === 'list' ? 'list' : 'grid');
    items.forEach((i, n) => {
      const c = renderItem(i, layout === 'list' ? 'list' : 'grid');
      if (!c) return;
      if (n >= 6 && node.querySelector('.shelf-more')) c.classList.add('shelf-hidden');
      box.appendChild(c);
    });
    const more = node.querySelector('.shelf-more');
    if (more) {
      more.onclick = () => {
        box.querySelectorAll('.shelf-hidden').forEach((c) => c.classList.remove('shelf-hidden'));
        more.remove();
      };
    }
  }
  return box.children.length ? node : null;
}

export function renderItem(item, variant = 'grid') {
  if (!item || isFiltered(item)) return null;
  switch (item.type) {
    case 'video':
      return videoCard(item, variant);
    case 'short':
      return variant === 'list' ? videoCard({ ...item, duration: 'SHORTS', channel: null }, 'list') : shortCard(item);
    case 'channel':
      return channelCard(item, variant === 'grid' ? 'grid' : 'list');
    case 'playlist':
      return playlistCard(item, variant);
    case 'post':
      return postCard(item);
    case 'shelf':
      return shelf(item, variant);
    default:
      return null;
  }
}

// Fügt Elemente ein; einzelne Shorts im Raster werden zu einem Shorts-Regal gebündelt.
export function appendItems(container, items, variant = 'grid') {
  let shortsBuffer = [];
  const flush = () => {
    if (!shortsBuffer.length) return;
    if (variant === 'grid' && container.classList.contains('rich-grid')) {
      const s = shelf({ type: 'shelf', title: 'Shorts', shorts: true, items: shortsBuffer });
      if (s) {
        s.classList.add('full-row');
        container.appendChild(s);
      }
    } else {
      for (const s of shortsBuffer) {
        const c = renderItem(s, variant);
        if (c) container.appendChild(c);
      }
    }
    shortsBuffer = [];
  };
  for (const item of items) {
    if (item.type === 'short' && variant === 'grid' && container.classList.contains('rich-grid')) {
      shortsBuffer.push(item);
      continue;
    }
    flush();
    const c = renderItem(item, variant);
    if (!c) continue;
    if (item.type === 'shelf' || item.type === 'post') c.classList.add('full-row');
    container.appendChild(c);
  }
  flush();
}

// ---- Endlos-Scrollen ------------------------------------------------------------
export function infinite(container, loadMore, { signal } = {}) {
  const sentinel = el('<div class="sentinel"><div class="spinner"></div></div>');
  container.after(sentinel);
  let busy = false;
  let done = false;
  const io = new IntersectionObserver(async (entries) => {
    if (!entries.some((e) => e.isIntersecting) || busy || done) return;
    busy = true;
    try {
      const more = await loadMore();
      if (!more) stop();
    } catch (e) {
      if (e.name !== 'AbortError') {
        sentinel.innerHTML = '';
        const b = el('<button class="btn btn-outline">Erneut versuchen</button>');
        b.onclick = () => {
          sentinel.innerHTML = '<div class="spinner"></div>';
          busy = false;
          io.unobserve(sentinel);
          io.observe(sentinel);
        };
        sentinel.appendChild(b);
        return;
      }
    } finally {
      busy = false;
    }
    // Falls die Seite noch nicht voll ist, weiterladen.
    if (!done) {
      io.unobserve(sentinel);
      io.observe(sentinel);
    }
  }, { rootMargin: '1200px 0px' });
  io.observe(sentinel);
  const stop = () => {
    done = true;
    io.disconnect();
    sentinel.remove();
  };
  signal?.addEventListener('abort', stop);
  return { stop };
}

export function skeletonGrid(n = 12, variant = 'grid') {
  return el(html`<div class="${variant === 'grid' ? 'rich-grid' : 'list-col'} skeleton-wrap">${Array.from({ length: n }, () => raw(`<div class="skeleton-card s-${variant}"><div class="sk-thumb"></div><div class="sk-row"><div class="sk-avatar"></div><div class="sk-lines"><div></div><div></div></div></div></div>`))}</div>`);
}

export function emptyState(title, text = '', iconName = 'library') {
  return el(html`<div class="empty-state">${raw(icon(iconName, 'empty-icon'))}<h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}</div>`);
}

// ---- Toast ---------------------------------------------------------------------
let toastTimer;
export function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = '';
  t.appendChild(document.createTextNode(msg));
  if (action) {
    const b = el(`<button class="btn btn-text toast-action">${esc(action.label)}</button>`);
    b.onclick = () => {
      action.run();
      t.classList.remove('show');
    };
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3500);
}

// ---- Menüs & Dialoge ---------------------------------------------------------------
let openOverlay = null;

export function closeOverlay() {
  if (!openOverlay) return;
  const o = openOverlay;
  openOverlay = null;
  o.node.classList.add('closing');
  o.onClose?.();
  setTimeout(() => o.node.remove(), 150);
  document.removeEventListener('keydown', o.onKey);
}

function mountOverlay(node, onClose) {
  closeOverlay();
  document.getElementById('overlay-root').appendChild(node);
  const onKey = (e) => {
    if (e.key === 'Escape') closeOverlay();
  };
  document.addEventListener('keydown', onKey);
  openOverlay = { node, onKey, onClose };
  node.addEventListener('click', (e) => {
    if (e.target === node) closeOverlay();
  });
}

// items: [{ icon, label, run, danger, divider }]
export function openMenu(anchor, items) {
  const sheet = isMobile();
  const node = el(html`<div class="menu-layer ${sheet ? 'as-sheet' : ''}">
    <div class="menu ${sheet ? 'sheet' : 'popup'}" role="menu">
      ${sheet ? raw('<div class="sheet-handle"></div>') : ''}
      ${items.map((it, i) => (it.divider ? raw('<hr>') : html`<button class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem" data-i="${i}">${it.icon ? raw(icon(it.icon)) : ''}<span>${it.label}</span>${it.check ? raw(icon('check', 'menu-check')) : ''}</button>`))}
    </div></div>`);
  node.querySelectorAll('.menu-item').forEach((b) => {
    b.addEventListener('click', () => {
      const it = items[Number(b.dataset.i)];
      closeOverlay();
      it.run?.();
    });
  });
  mountOverlay(node);
  if (!sheet && anchor) {
    const m = node.querySelector('.menu');
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let left = r.right - mw;
    if (left < 8) left = Math.min(r.left, innerWidth - mw - 8);
    let top = r.bottom + 4;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = `${Math.max(8, left)}px`;
    m.style.top = `${top}px`;
  }
  node.querySelector('.menu-item')?.focus({ preventScroll: true });
}

export function openDialog({ title, body, actions = [], className = '', onClose }) {
  const node = el(html`<div class="dialog-layer"><div class="dialog ${className}" role="dialog" aria-modal="true" aria-label="${title || ''}">
      ${title ? html`<div class="dialog-head"><h2>${title}</h2><button class="icon-btn dialog-close" aria-label="Schließen">${raw(icon('close'))}</button></div>` : ''}
      <div class="dialog-body"></div>
      ${actions.length ? html`<div class="dialog-actions">${actions.map((a, i) => html`<button class="btn ${a.primary ? 'btn-blue' : 'btn-text'}" data-a="${i}">${a.label}</button>`)}</div>` : ''}
    </div></div>`);
  const b = node.querySelector('.dialog-body');
  if (body instanceof Node) b.appendChild(body);
  else if (body != null) b.innerHTML = String(body);
  node.querySelector('.dialog-close')?.addEventListener('click', closeOverlay);
  node.querySelectorAll('[data-a]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const a = actions[Number(btn.dataset.a)];
      if (a.run) {
        const keep = await a.run(node);
        if (keep === false) return;
      }
      closeOverlay();
    });
  });
  mountOverlay(node, onClose);
  return node;
}

// ---- Video-Aktionen ------------------------------------------------------------
export function videoMenu(item, anchor, card) {
  const video = { id: item.id, title: item.title, thumbnail: item.thumbnail, duration: item.duration, channel: item.channel, short: !!item.short };
  const items = [
    { icon: 'addQueue', label: 'Zur Wiedergabeliste hinzufügen', run: () => addToQueue(video) },
    { icon: 'clock', label: 'Zu „Später ansehen“ hinzufügen', run: () => saveTo(video, 'WL', true) },
    { icon: 'save', label: 'In Playlist speichern', run: () => saveDialog(video) },
    { icon: 'download', label: 'Herunterladen', run: () => downloadDialog(video) },
    { icon: 'share', label: 'Teilen', run: () => shareDialog(video) },
    { divider: true },
    { icon: 'block', label: 'Kein Interesse', run: () => {
      hideVideo(item.id);
      card?.remove();
      toast('Video entfernt');
    } }
  ];
  if (item.channel?.id) {
    items.push({ icon: 'dontRecommend', label: 'Kanal nicht empfehlen', run: () => {
      blockChannel(item.channel);
      document.querySelectorAll(`.video-card`).forEach((c) => {
        if (c.querySelector(`a[href="/channel/${item.channel.id}"]`)) c.remove();
      });
      toast(`Videos von ${item.channel.name || 'diesem Kanal'} werden nicht mehr empfohlen`);
    } });
  }
  openMenu(anchor, items);
}

export function addToQueue(video) {
  if (!state.queue.some((v) => v.id === video.id)) state.queue.push(video);
  toast('Zur Wiedergabeliste hinzugefügt');
}

export async function saveTo(video, playlistId, on) {
  try {
    await api('/api/save', { method: 'POST', body: { video, playlistId, on } });
    toast(on ? `Gespeichert in ${playlistId === 'WL' ? '„Später ansehen“' : 'Playlist'}` : 'Entfernt');
  } catch (e) {
    toast(e.message);
  }
}

export async function saveDialog(video) {
  const body = el('<div class="save-list"><div class="spinner"></div></div>');
  openDialog({ title: 'Speichern unter…', body, className: 'save-dialog' });
  let opts;
  try {
    opts = (await api(`/api/save-options/${video.id}`)).options;
  } catch (e) {
    body.textContent = e.message;
    return;
  }
  body.innerHTML = '';
  for (const o of opts) {
    const row = el(html`<label class="check-row"><input type="checkbox" ${o.on ? raw('checked') : ''}><span>${o.title}</span>${raw(icon(o.privacy === 'PUBLIC' ? 'globe' : 'lock', 'muted-icon'))}${o.local ? html`<small class="tag">lokal</small>` : ''}</label>`);
    row.querySelector('input').addEventListener('change', (e) => saveTo(video, o.id, e.target.checked));
    body.appendChild(row);
  }
  const create = el(html`<button class="menu-item create-pl">${raw(icon('add'))}<span>Neue Playlist erstellen</span></button>`);
  create.onclick = () => {
    const form = el(html`<form class="create-form">
      <label class="field"><span>Name</span><input name="title" maxlength="150" required placeholder="Namen eingeben…"></label>
      <label class="field"><span>Sichtbarkeit</span><select name="privacy"><option value="PRIVATE">Privat</option><option value="UNLISTED">Nicht gelistet</option><option value="PUBLIC">Öffentlich</option></select></label>
      ${signedIn() ? html`<label class="check-row small"><input type="checkbox" name="local"><span>Nur auf diesem Handy speichern</span></label>` : ''}
      <div class="dialog-actions"><button class="btn btn-blue" type="submit">Erstellen</button></div>
    </form>`);
    create.replaceWith(form);
    form.title.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/playlists', { method: 'POST', body: { title: form.title.value, privacy: form.privacy.value, local: !signedIn() || form.local?.checked, videoIds: [video.id], video } });
        toast(`Gespeichert in ${form.title.value}`);
        closeOverlay();
      } catch (err) {
        toast(err.message);
      }
    };
  };
  body.appendChild(create);
}

export function shareDialog(video, time = 0) {
  const ytUrl = `https://youtu.be/${video.id}${time ? `?t=${Math.floor(time)}` : ''}`;
  const localUrl = `${location.origin}/watch?v=${video.id}${time ? `&t=${Math.floor(time)}` : ''}`;
  if (navigator.share && isMobile()) {
    navigator.share({ title: video.title, url: ytUrl }).catch(() => {});
    return;
  }
  const body = el(html`<div class="share">
    <div class="share-row"><input readonly value="${ytUrl}" class="share-url"><button class="btn btn-blue share-copy">Kopieren</button></div>
    ${time ? html`<label class="check-row small"><input type="checkbox" class="share-time" checked><span>Bei ${formatTime(time)} beginnen</span></label>` : ''}
    <p class="muted small">Link für diese App: <a href="${localUrl}">${localUrl}</a></p>
  </div>`);
  const input = body.querySelector('.share-url');
  body.querySelector('.share-time')?.addEventListener('change', (e) => {
    input.value = e.target.checked ? ytUrl : `https://youtu.be/${video.id}`;
  });
  body.querySelector('.share-copy').onclick = () => copyText(input.value).then(() => toast('Link kopiert'));
  openDialog({ title: 'Teilen', body });
}

export async function downloadDialog(video) {
  const body = el('<div class="download-list"><div class="spinner"></div></div>');
  openDialog({ title: 'Herunterladen', body, className: 'download-dialog' });
  try {
    const [{ options }, off] = await Promise.all([api(`/api/download/${video.id}`), api('/api/offline').catch(() => ({ items: [], jobs: [] }))]);
    body.innerHTML = '';
    const have = off.items.find((i) => i.id === video.id);
    if (have) {
      const row = el(html`<div class="dl-have">${raw(icon('check'))}<span>Bereits heruntergeladen${have.label ? ` (${have.label})` : ''}</span><a class="btn btn-text" href="/feed/downloads">Ansehen</a></div>`);
      row.querySelector('a').addEventListener('click', () => closeOverlay());
      body.appendChild(row);
    }
    if (!options.length) body.appendChild(document.createTextNode('Für dieses Video sind keine Downloads verfügbar.'));
    const safe = (video.title || video.id).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    for (const o of options) {
      const row = el(html`<button class="menu-item dl-row">${raw(icon(o.kind === 'audio' ? 'music' : 'download'))}<span><b>${o.label}</b><small class="muted">${o.sub}</small></span></button>`);
      row.addEventListener('click', async () => {
        // Immer im App-Speicher sichern – so geht es auch ohne Internet.
        try {
          await api(`/api/offline/${video.id}`, {
            method: 'POST',
            body: {
              url: o.url,
              label: o.label,
              audioOnly: o.kind === 'audio',
              title: video.title || '',
              short: !!video.short,
              duration: video.duration || 0,
              channel: video.channel ? { id: video.channel.id || '', name: video.channel.name || '', avatar: video.channel.avatar || '' } : null
            }
          });
          toast('Download gestartet – zu finden unter „Du“ → „Downloads“');
        } catch (e) {
          toast(e.message);
          return;
        }
        // Optional (Einstellungen): zusätzlich eine Kopie in die Galerie/den Download-Ordner.
        if (state.settings.saveToGallery) {
          const href = o.direct ? `${o.url}&dl=${encodeURIComponent(safe + (o.kind === 'audio' ? '.m4a' : '.mp4'))}` : o.url;
          const a = document.createElement('a');
          a.href = href;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        setTimeout(closeOverlay, 200);
      });
      body.appendChild(row);
    }
    body.appendChild(el('<p class="muted small dl-hint">Downloads werden in der App gespeichert und lassen sich auch ohne Internet ansehen.</p>'));
  } catch (e) {
    body.textContent = e.message;
  }
}

// ---- Abo-Button -------------------------------------------------------------------
export function subscribeButton(channel, subscribed, { onChange } = {}) {
  let on = subscribed ?? state.subs?.has(channel.id) ?? false;
  const btn = el('<button class="btn sub-btn"></button>');
  const paint = () => {
    btn.classList.toggle('subscribed', on);
    btn.innerHTML = on ? `${icon('bell')}<span>Abonniert</span>${icon('down', 'sub-caret')}` : '<span>Abonnieren</span>';
  };
  paint();
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (on) {
      const items = [];
      if (signedIn()) {
        items.push({ icon: 'bellActive', label: 'Alle', run: () => notifPref(channel, 'ALL') });
        items.push({ icon: 'bell', label: 'Personalisiert', run: () => notifPref(channel, 'PERSONALIZED') });
        items.push({ icon: 'bellOff', label: 'Keine', run: () => notifPref(channel, 'NONE') });
        items.push({ divider: true });
      }
      items.push({ icon: 'unsubscribe', label: 'Abo beenden', danger: true, run: () => {
        openDialog({
          body: html`<p>Abo für ${channel.name || 'diesen Kanal'} beenden?</p>`,
          actions: [{ label: 'Abbrechen' }, { label: 'Abo beenden', primary: true, run: () => toggle(false) }]
        });
      } });
      openMenu(btn, items);
    } else {
      toggle(true);
    }
  });
  async function toggle(next) {
    const prev = on;
    on = next;
    paint();
    try {
      await api('/api/subscribe', { method: 'POST', body: { channel, on: next } });
      if (state.subs) {
        if (next) state.subs.add(channel.id);
        else state.subs.delete(channel.id);
      }
      toast(next ? 'Abo hinzugefügt' : 'Abo entfernt');
      onChange?.(next);
    } catch (err) {
      on = prev;
      paint();
      toast(err.message);
    }
  }
  return btn;
}

async function notifPref(channel, type) {
  try {
    await api('/api/notifications/pref', { method: 'POST', body: { channelId: channel.id, type } });
    toast('Benachrichtigungseinstellung gespeichert');
  } catch (e) {
    toast(e.message);
  }
}

// ---- Chips --------------------------------------------------------------------
export function chipBar(chips, active, onSelect) {
  const bar = el('<div class="chip-bar"><div class="chips" role="tablist"></div></div>');
  const box = bar.querySelector('.chips');
  for (const c of chips) {
    const label = typeof c === 'string' ? c : c.label;
    const value = typeof c === 'string' ? c : c.value;
    const b = el(html`<button class="chip ${value === active ? 'active' : ''}" role="tab">${label}</button>`);
    b.onclick = () => {
      box.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      onSelect(value);
    };
    box.appendChild(b);
  }
  return bar;
}
