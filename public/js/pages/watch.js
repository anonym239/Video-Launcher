// Wiedergabeseite: Player, Infos, Beschreibung, Kommentare, ähnliche Videos, Playlist.
import { api, el, html, raw, qs, compact, formatTime, parseTimeParam, $ } from '../util.js';
import { icon } from '../icons.js';
import { avatar, appendItems, infinite, subscribeButton, toast, openMenu, openDialog, saveDialog, shareDialog, downloadDialog, addToQueue, isMobile } from '../components.js';
import { player } from '../player.js';
import { state, on, signedIn } from '../state.js';
import { go } from '../router.js';
import { mini } from '../app.js';
import { mountComments } from './comments.js';

export default async function watch({ node, query, signal }) {
  const id = query.get('v');
  if (!/^[\w-]{11}$/.test(id || '')) {
    node.innerHTML = '<div class="empty-state"><h2>Ungültiger Videolink</h2></div>';
    return;
  }
  const listId = query.get('list');
  const startParam = parseTimeParam(query.get('t') || query.get('start'));
  const theater = localStorage.getItem('vl:theater') === '1';

  node.innerHTML = html`
    <div class="watch ${theater ? 'theater' : ''}">
      <div class="watch-player-wrap"><div class="watch-player-slot"></div></div>
      <div class="watch-columns">
        <div class="watch-primary">
          <div class="watch-info"><div class="skeleton-info"><div></div><div></div><div></div></div></div>
          <div class="watch-comments"></div>
          <div class="watch-mobile-secondary"></div>
        </div>
        <div class="watch-secondary">
          <div class="watch-playlist"></div>
          <div class="related list-col compact"></div>
        </div>
      </div>
    </div>`.toString();

  const slot = node.querySelector('.watch-player-slot');
  const wasMini = mini.active && mini.info?.id === id;
  if (mini.active) mini.hide();
  slot.appendChild(player.root);
  player.setMode('full');

  const cached = { id, title: '', channel: null };
  const startAt = startParam || (state.positions[id] && !listId ? state.positions[id] : 0);
  if (!wasMini || player.meta?.id !== id) {
    player.load(cached, { startAt });
  }

  // Ereignisse vom Player
  const offs = [
    on('player:theater', () => {
      const w = node.querySelector('.watch');
      const t = !w.classList.contains('theater');
      w.classList.toggle('theater', t);
      localStorage.setItem('vl:theater', t ? '1' : '0');
    }),
    on('player:chapters', () => chaptersDialog(data))
  ];

  // Zeitstempel-Links in Beschreibung und Kommentaren
  const onLinkClick = (e) => {
    const a = e.target.closest('a[data-seek]');
    if (!a) return;
    if (a.dataset.video === id) {
      e.preventDefault();
      e.stopPropagation();
      player.seek(Number(a.dataset.seek));
      player.play();
      if (isMobile()) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  node.addEventListener('click', onLinkClick, true);

  let data;
  try {
    data = await api(`/api/video/${id}` + qs({ list: listId, index: query.get('index') }), { signal });
  } catch (e) {
    if (e.name === 'AbortError') return cleanup;
    node.querySelector('.watch-info').innerHTML = '';
    node.querySelector('.watch-info').appendChild(el(html`<div class="error-state"><h2>Video-Infos konnten nicht geladen werden</h2><p>${e.message}</p></div>`));
    return cleanup;
  }
  if (signal.aborted) return cleanup;

  document.title = `${data.title} - Video Launcher`;
  const meta = { id, title: data.title, channel: data.channel, duration: data.duration };
  Object.assign(cached, meta);
  if (player.meta?.id === id) {
    Object.assign(player.meta, meta);
    player.root.querySelector('.p-title').textContent = data.title;
    player.root.querySelector('.p-mini-title').textContent = data.title;
    player.root.querySelector('.p-mini-channel').textContent = data.channel.name;
  }
  player.setChapters(data.chapters);
  player.setHeat(data.heat);

  // Verlauf
  api('/api/history', { method: 'POST', body: { video: { id, title: data.title, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, duration: data.durationText, channel: data.channel } } }).catch(() => {});

  renderInfo(node.querySelector('.watch-info'), data);
  if (data.playlist) renderPlaylist(node.querySelector('.watch-playlist'), data.playlist, id);
  renderRelated(node, data, signal);
  mountComments(node.querySelector('.watch-comments'), { id }, { signal, countHint: data.commentCount });

  // Nächstes / Vorheriges
  const pl = data.playlist;
  const plIndex = pl ? pl.items.findIndex((v) => v.id === id) : -1;
  const nextFromPlaylist = () => {
    if (!pl || plIndex < 0) return null;
    const loop = localStorage.getItem('vl:plLoop') === '1';
    const shuffle = localStorage.getItem('vl:plShuffle') === '1';
    if (shuffle && pl.items.length > 1) {
      let i;
      do i = Math.floor(Math.random() * pl.items.length);
      while (i === plIndex);
      return pl.items[i];
    }
    return pl.items[plIndex + 1] || (loop ? pl.items[0] : null);
  };
  const nextVideo = () => {
    if (state.queue.length) return { ...state.queue[0], fromQueue: true };
    const p = nextFromPlaylist();
    if (p) return { ...p, list: pl.id };
    const r = data.related.find((v) => v.type === 'video' && !v.live) || null;
    return r;
  };
  const playNext = () => {
    const n = nextVideo();
    if (!n) return;
    if (n.fromQueue) state.queue.shift();
    go(`/watch?v=${n.id}${n.list ? `&list=${encodeURIComponent(n.list)}` : ''}`);
  };
  player.setHooks({
    onNext: playNext,
    onPrev: plIndex > 0 ? () => go(`/watch?v=${pl.items[plIndex - 1].id}&list=${encodeURIComponent(pl.id)}`) : null,
    onEnded: () => {
      if (player.loop) return;
      const n = nextVideo();
      if (!n) return;
      if (pl && plIndex >= 0 && !n.fromQueue && n.list) return playNext();
      if (n.fromQueue) return playNext();
      if (state.settings.autoplay !== false) player.showUpNext(n, playNext);
    }
  });

  function cleanup() {
    offs.forEach((f) => f());
    node.removeEventListener('click', onLinkClick, true);
    document.title = 'Video Launcher';
    // Weiter zu einem anderen Video? Dann bleibt der Player einfach stehen.
    if (location.pathname === '/watch') return;
    if (player.meta && player.root.dataset.state !== 'ended' && player.root.dataset.state !== 'error') {
      mini.show({ id, url: `/watch?v=${id}${listId ? `&list=${encodeURIComponent(listId)}` : ''}` });
    } else {
      player.stop();
      $('#player-host').appendChild(player.root);
    }
  }
  return cleanup;
}

function renderInfo(box, d) {
  const video = { id: d.id, title: d.title, thumbnail: `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`, duration: d.durationText, channel: d.channel };
  box.innerHTML = '';
  const info = el(html`<div>
    ${d.superTitle ? html`<div class="super-title">${raw(d.superTitle)}</div>` : ''}
    <h1 class="watch-title">${d.title}</h1>
    <div class="watch-mobile-meta"><a class="wm-channel" href="/channel/${d.channel.id}">${d.channel.handle || d.channel.name}</a>${d.likes != null ? html` <span>${compact(d.likes)} Likes</span>` : ''} <span>${d.shortViews || d.views}</span>${d.relativeDate ? html` <span>${d.relativeDate}</span>` : ''} <button class="link-btn more-link">mehr</button></div>
    <div class="watch-owner-row">
      <div class="owner">
        <a href="/channel/${d.channel.id}" class="owner-avatar">${avatar(d.channel.avatar, 40, d.channel.name)}</a>
        <div class="owner-text">
          <a href="/channel/${d.channel.id}" class="owner-name">${d.channel.name}${d.channel.verified ? raw(`<span class="verified">${icon('verified')}</span>`) : ''}</a>
          <div class="owner-subs">${d.channel.subscribers}</div>
        </div>
        <div class="owner-sub"></div>
      </div>
      <div class="watch-actions">
        <div class="seg-btn like-group">
          <button class="btn btn-tonal like-btn ${d.liked ? 'on' : ''}" aria-label="Mag ich">${raw(icon(d.liked ? 'likeFilled' : 'like'))}<span class="like-count">${d.likes != null ? compact(d.likes) : ''}</span></button>
          <button class="btn btn-tonal dislike-btn ${d.disliked ? 'on' : ''}" aria-label="Mag ich nicht">${raw(icon(d.disliked ? 'dislikeFilled' : 'dislike'))}</button>
        </div>
        <button class="btn btn-tonal share-btn">${raw(icon('share'))}<span>Teilen</span></button>
        <button class="btn btn-tonal save-btn">${raw(icon(isMobile() ? 'bookmark' : 'save'))}<span>Speichern</span></button>
        <button class="btn btn-tonal dl-btn">${raw(icon('download'))}<span>Herunterladen</span></button>
        <button class="icon-btn btn-tonal round more-btn" aria-label="Weitere Aktionen">${raw(icon('moreH'))}</button>
      </div>
    </div>
    <div class="description collapsed" tabindex="0">
      <div class="desc-stats"><b>${d.views}${d.published ? html`  ${d.published}` : ''}</b> ${d.keywords.slice(0, 3).map((k) => html`<a class="desc-tag" href="/hashtag/${encodeURIComponent(k.replace(/^#/, '').replace(/\s+/g, ''))}">#${k.replace(/^#/, '').replace(/\s+/g, '')}</a> `)}</div>
      <div class="desc-text">${raw(d.descriptionHtml)}</div>
      <div class="desc-extra"></div>
      <button class="link-btn desc-toggle">…mehr</button>
    </div>
  </div>`);
  box.appendChild(info);
  info.querySelector('.owner-sub').appendChild(subscribeButton({ id: d.channel.id, name: d.channel.name, avatar: d.channel.avatar }, d.subscribed));

  // Beschreibung auf-/zuklappen
  const desc = info.querySelector('.description');
  const extra = info.querySelector('.desc-extra');
  if (d.chapters.length > 1) {
    const ch = el(html`<div class="desc-chapters"><h3>Kapitel</h3><div class="chapter-row">${d.chapters.map((c) => html`<a class="chapter-card" href="/watch?v=${d.id}&t=${c.start}s" data-seek="${c.start}" data-video="${d.id}">${c.thumbnail ? html`<img src="${c.thumbnail}" alt="" loading="lazy">` : ''}<div><b>${c.title}</b><span>${formatTime(c.start)}</span></div></a>`)}</div></div>`);
    extra.appendChild(ch);
  }
  for (const r of d.metadataRows) extra.appendChild(el(html`<div class="desc-meta-row"><b>${r.title}</b><span>${r.value}</span></div>`));
  const toggle = (open) => {
    desc.classList.toggle('collapsed', !open);
    info.querySelector('.desc-toggle').textContent = open ? 'Weniger anzeigen' : '…mehr';
  };
  desc.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (desc.classList.contains('collapsed')) toggle(true);
  });
  info.querySelector('.desc-toggle').onclick = (e) => {
    e.stopPropagation();
    toggle(desc.classList.contains('collapsed'));
  };
  info.querySelector('.more-link').onclick = () => {
    toggle(true);
    desc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Bewertung
  const likeBtn = info.querySelector('.like-btn');
  const dislikeBtn = info.querySelector('.dislike-btn');
  let rating = d.liked ? 'like' : d.disliked ? 'dislike' : 'none';
  let likes = d.likes;
  const paint = () => {
    likeBtn.classList.toggle('on', rating === 'like');
    dislikeBtn.classList.toggle('on', rating === 'dislike');
    likeBtn.innerHTML = `${icon(rating === 'like' ? 'likeFilled' : 'like')}<span class="like-count">${likes != null ? compact(likes) : ''}</span>`;
    dislikeBtn.innerHTML = icon(rating === 'dislike' ? 'dislikeFilled' : 'dislike');
  };
  const rate = async (r) => {
    const prev = rating;
    const prevLikes = likes;
    if (likes != null) likes += (r === 'like' ? 1 : 0) - (prev === 'like' ? 1 : 0);
    rating = r;
    paint();
    try {
      await api('/api/rate', { method: 'POST', body: { id: d.id, rating: r, video } });
      if (r === 'like') toast(signedIn() ? 'Zu „Videos mit ‚Mag ich‘“ hinzugefügt' : 'Lokal zu „Mag ich“ hinzugefügt');
    } catch (e) {
      rating = prev;
      likes = prevLikes;
      paint();
      toast(e.message);
    }
  };
  likeBtn.onclick = () => rate(rating === 'like' ? 'none' : 'like');
  dislikeBtn.onclick = () => rate(rating === 'dislike' ? 'none' : 'dislike');

  info.querySelector('.share-btn').onclick = () => shareDialog(video, player.meta?.id === d.id ? player.video.currentTime : 0);
  info.querySelector('.save-btn').onclick = () => saveDialog(video);
  info.querySelector('.dl-btn').onclick = () => downloadDialog(video);
  info.querySelector('.more-btn').onclick = (e) =>
    openMenu(e.currentTarget, [
      ...(isMobile() ? [{ icon: 'download', label: 'Herunterladen', run: () => downloadDialog(video) }] : []),
      { icon: 'addQueue', label: 'Zur Wiedergabeliste hinzufügen', run: () => addToQueue(video) },
      { icon: 'clock', label: 'Später ansehen', run: () => api('/api/save', { method: 'POST', body: { video, playlistId: 'WL', on: true } }).then(() => toast('Zu „Später ansehen“ hinzugefügt')).catch((er) => toast(er.message)) },
      { icon: 'external', label: 'Auf youtube.com öffnen', run: () => window.open(`https://www.youtube.com/watch?v=${d.id}`, '_blank', 'noopener') },
      { icon: 'info', label: 'Statistiken', run: () => statsDialog(d) }
    ]);
}

function renderPlaylist(box, pl, currentId) {
  const loop = localStorage.getItem('vl:plLoop') === '1';
  const shuffle = localStorage.getItem('vl:plShuffle') === '1';
  const idx = pl.items.findIndex((v) => v.id === currentId);
  const panel = el(html`<div class="pl-panel">
    <div class="pl-panel-head">
      <div><h3><a href="/playlist?list=${encodeURIComponent(pl.id)}">${pl.title}</a></h3><div class="muted small">${pl.author ? html`${pl.author} – ` : ''}${idx + 1} / ${pl.total || pl.items.length}</div></div>
      <div class="pl-panel-actions">
        <button class="icon-btn pl-loop ${loop ? 'on' : ''}" aria-label="Playlist wiederholen">${raw(icon('repeat'))}</button>
        <button class="icon-btn pl-shuffle ${shuffle ? 'on' : ''}" aria-label="Zufallsmix">${raw(icon('shuffle'))}</button>
        <button class="icon-btn pl-collapse" aria-label="Einklappen">${raw(icon('up'))}</button>
      </div>
    </div>
    <div class="pl-panel-items"></div>
  </div>`);
  const items = panel.querySelector('.pl-panel-items');
  pl.items.forEach((v, i) => {
    const row = el(html`<a class="pl-row ${v.id === currentId ? 'current' : ''}" href="/watch?v=${v.id}&list=${encodeURIComponent(pl.id)}&index=${i + 1}">
      <span class="pl-idx">${v.id === currentId ? raw(icon('play')) : i + 1}</span>
      <span class="plr-thumb"><img src="${v.thumbnail}" alt="" loading="lazy">${v.duration ? html`<span class="thumb-badge">${v.duration}</span>` : ''}</span>
      <span class="pl-text"><b>${v.title}</b><span class="muted small">${v.channel?.name || ''}</span></span>
    </a>`);
    items.appendChild(row);
  });
  panel.querySelector('.pl-loop').onclick = (e) => {
    const on = e.currentTarget.classList.toggle('on');
    localStorage.setItem('vl:plLoop', on ? '1' : '0');
  };
  panel.querySelector('.pl-shuffle').onclick = (e) => {
    const on = e.currentTarget.classList.toggle('on');
    localStorage.setItem('vl:plShuffle', on ? '1' : '0');
  };
  panel.querySelector('.pl-collapse').onclick = (e) => {
    const c = panel.classList.toggle('collapsed');
    e.currentTarget.innerHTML = icon(c ? 'down' : 'up');
  };
  box.appendChild(panel);
  requestAnimationFrame(() => items.querySelector('.current')?.scrollIntoView({ block: 'nearest' }));
}

function renderRelated(node, data, signal) {
  const list = node.querySelector('.related');
  const mobileBox = node.querySelector('.watch-mobile-secondary');
  // Auf dem Handy stehen die ähnlichen Videos direkt unter den Infos.
  const mq = matchMedia('(max-width: 999px)');
  const place = () => {
    const target = mq.matches ? mobileBox : node.querySelector('.watch-secondary');
    if (list.parentElement !== target) target.appendChild(list);
  };
  place();
  mq.addEventListener?.('change', place);
  signal.addEventListener('abort', () => mq.removeEventListener?.('change', place));

  const variant = () => (mq.matches ? 'grid' : 'compact');
  appendItems(list, data.related, variant());
  let cont = data.relatedCont;
  if (cont) {
    infinite(list, async () => {
      const more = await api('/api/related' + qs({ cont }), { signal });
      appendItems(list, more.items, variant());
      data.related.push(...more.items);
      cont = more.cont;
      return !!cont && more.items.length > 0;
    }, { signal });
  }
}

function chaptersDialog(d) {
  if (!d?.chapters?.length) return;
  const body = el('<div class="chapter-list"></div>');
  for (const c of d.chapters) {
    const row = el(html`<button class="chapter-item">${c.thumbnail ? html`<img src="${c.thumbnail}" alt="">` : ''}<div><b>${c.title}</b><span class="muted small">${formatTime(c.start)}</span></div></button>`);
    row.onclick = () => {
      player.seek(c.start);
      player.play();
      document.querySelector('.dialog-close')?.click();
    };
    body.appendChild(row);
  }
  openDialog({ title: 'Kapitel', body, className: 'chapters-dialog' });
}

function statsDialog(d) {
  const s = player.streams || {};
  const v = player.video;
  const active = player.shaka?.getVariantTracks().find((t) => t.active);
  const rows = [
    ['Video-ID', d.id],
    ['Quelle', `${s.source || '?'} (${s.client || '?'})`],
    ['Wiedergabe', player.source || '?'],
    ['Auflösung', `${v.videoWidth}×${v.videoHeight}`],
    ['Codecs', active ? `${active.videoCodec || ''} / ${active.audioCodec || ''}` : '–'],
    ['Bandbreite', active ? `${Math.round(active.bandwidth / 1000)} kbit/s` : '–'],
    ['Puffer', v.buffered.length ? `${(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1)} s` : '0 s']
  ];
  openDialog({ title: 'Statistiken', body: html`<table class="stats">${rows.map(([k, val]) => html`<tr><th>${k}</th><td>${val}</td></tr>`)}</table>` });
}
