// Shorts: vertikal wischen, Endlos-Feed, Autoplay in Schleife.
import { api, el, html, raw, qs, compact, reportPlaying } from '../util.js';
import { icon } from '../icons.js';
import { avatar, subscribeButton, toast, shareDialog, openMenu, saveDialog, downloadDialog, closeOverlay, isMobile } from '../components.js';
import { mini } from '../app.js';
import { go } from '../router.js';
import { mountComments } from './comments.js';

export default async function shorts({ node, params, signal }) {
  if (mini.active) mini.close();
  node.innerHTML = html`<div class="shorts-page">
    <div class="shorts-scroller" tabindex="0"></div>
    <div class="shorts-nav">
      <button class="icon-btn round btn-tonal shorts-up" aria-label="Vorheriges Short">${raw(icon('up'))}</button>
      <button class="icon-btn round btn-tonal shorts-down" aria-label="Nächstes Short">${raw(icon('down'))}</button>
    </div>
  </div>`.toString();
  const scroller = node.querySelector('.shorts-scroller');
  const video = el('<video class="short-video" playsinline loop preload="auto"></video>');
  video.muted = localStorage.getItem('vl:shortsMuted') === '1';
  let shakaPlayer = null;
  let ids = [];
  let cont = null;
  let active = -1;
  let loading = false;
  let loadToken = 0;
  const metaCache = new Map();

  // ---- Feed laden ----------------------------------------------------------------
  async function fetchMore() {
    if (loading) return;
    loading = true;
    try {
      let data;
      if (cont) data = await api('/api/shorts' + qs({ cont, seed: engaged.shift() }), { signal });
      else data = await api('/api/shorts' + qs({ seed: params.id }), { signal });
      cont = data.cont;
      const fresh = data.ids.filter((id) => !ids.includes(id));
      for (const id of fresh) addSlide(id);
      // Die ersten Shorts sofort anfragen (Streams laufen parallel zum Aufbau der Seite).
      fresh.slice(0, 2).forEach((id) => getStreams(id).catch(() => {}));
    } finally {
      loading = false;
    }
  }

  function addSlide(id) {
    ids.push(id);
    const slide = el(html`<section class="short-slide" data-id="${id}" data-index="${ids.length - 1}">
      <div class="short-frame">
        <img class="short-poster" src="https://i.ytimg.com/vi/${id}/oar2.jpg" data-fallback="https://i.ytimg.com/vi/${id}/hq2.jpg" alt="" loading="lazy">
        <div class="short-video-slot"></div>
        <div class="short-top">
          <button class="short-round short-back" aria-label="Zurück">${raw(icon('back'))}</button>
          <span class="short-top-spacer"></span>
          <button class="short-round short-search" aria-label="Suchen">${raw(icon('search'))}</button>
          <button class="short-round more" aria-label="Mehr">${raw(icon('more'))}</button>
        </div>
        <div class="short-paused-icon">${raw(icon('play'))}</div>
        <div class="short-bottom">
          <div class="short-channel"></div>
          <div class="short-caption"></div>
        </div>
        <div class="short-progress"><div></div></div>
      </div>
      <div class="short-actions">
        <button class="short-act like" aria-label="Mag ich"><span class="sa-icon">${raw(icon('like'))}</span><span class="like-count">Mag ich</span></button>
        <button class="short-act dislike" hidden aria-label="Mag ich nicht"></button>
        <button class="short-act comments" aria-label="Kommentare"><span class="sa-icon">${raw(icon('comment'))}</span><span class="comment-count">Kommentare</span></button>
        <button class="short-act save" aria-label="Speichern"><span class="sa-icon">${raw(icon('bookmark'))}</span><span>Speichern</span></button>
        <button class="short-act share" aria-label="Teilen"><span class="sa-icon">${raw(icon('share'))}</span><span>Teilen</span></button>
        <a class="short-act ch-thumb" aria-label="Kanal"></a>
      </div>
    </section>`);
    scroller.appendChild(slide);
    io.observe(slide);
    bindSlide(slide, id);
  }

  async function loadMeta(id) {
    if (metaCache.has(id)) return metaCache.get(id);
    const p = api(`/api/short/${id}`, { signal }).catch(() => null);
    metaCache.set(id, p);
    return p;
  }

  async function fillSlide(slide, id) {
    if (slide.dataset.filled) return;
    slide.dataset.filled = '1';
    const m = await loadMeta(id);
    if (!m) return;
    slide._meta = m;
    if (m.offline && m.thumbnail) slide.querySelector('.short-poster').src = m.thumbnail;
    slide.querySelector('.short-caption').textContent = m.title;
    const ch = slide.querySelector('.short-channel');
    ch.innerHTML = '';
    ch.appendChild(el(html`<a href="/channel/${m.channel.id}" class="sc-link">${avatar(m.channel.avatar, 32, m.channel.name)}<span>@${m.channel.name.replace(/^@/, '')}</span></a>`));
    if (m.channel.id) ch.appendChild(subscribeButton({ id: m.channel.id, name: m.channel.name, avatar: m.channel.avatar }, m.subscribed));
    slide.querySelector('.like-count').textContent = m.likes != null ? compact(m.likes) : 'Mag ich';
    if (m.comments) slide.querySelector('.comment-count').textContent = m.comments;
    slide.querySelector('.like').classList.toggle('on', !!m.liked);
    slide.querySelector('.dislike').classList.toggle('on', !!m.disliked);
    slide._paintRating?.();
    const thumb = slide.querySelector('.ch-thumb');
    thumb.href = `/channel/${m.channel.id}`;
    thumb.innerHTML = String(avatar(m.channel.avatar, 40, m.channel.name));
  }

  function bindSlide(slide, id) {
    const frame = slide.querySelector('.short-frame');
    frame.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      if (Number(slide.dataset.index) !== active) return;
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
    slide.querySelector('.short-search').onclick = () => {
      document.body.classList.add('mobile-search');
      document.getElementById('search-input').focus();
    };
    slide.querySelector('.short-back').onclick = () => (history.length > 1 ? history.back() : go('/'));
    const toggleMute = () => {
      video.muted = !video.muted;
      localStorage.setItem('vl:shortsMuted', video.muted ? '1' : '0');
      toast(video.muted ? 'Ton aus' : 'Ton an');
    };
    const likeBtn = slide.querySelector('.like');
    const dislikeBtn = slide.querySelector('.dislike');
    // Aktiv = gefülltes Symbol (wie in der App).
    // Wie in der App: Symbole immer gefüllt, aktiv mit hellem Kreis und kurzem "Pop".
    const paintRating = () => {
      likeBtn.querySelector('.sa-icon').innerHTML = icon(likeBtn.classList.contains('on') ? 'likeFilled' : 'like');
      for (const b of [likeBtn, dislikeBtn]) {
        b.classList.remove('pop');
        if (b.classList.contains('on')) {
          void b.offsetWidth;
          b.classList.add('pop');
        }
      }
    };
    slide._paintRating = paintRating;
    const rate = async (r) => {
      const m = slide._meta || { title: '' };
      const v = { id, title: m.title, thumbnail: `https://i.ytimg.com/vi/${id}/oar2.jpg`, channel: m.channel, short: true };
      const prevLike = likeBtn.classList.contains('on');
      const prevDis = dislikeBtn.classList.contains('on');
      likeBtn.classList.toggle('on', r === 'like');
      dislikeBtn.classList.toggle('on', r === 'dislike');
      paintRating();
      try {
        await api('/api/rate', { method: 'POST', body: { id, rating: r, video: v } });
        if (m.likes != null) {
          const delta = (r === 'like' ? 1 : 0) - (prevLike ? 1 : 0);
          m.likes += delta;
          slide.querySelector('.like-count').textContent = compact(m.likes);
        }
      } catch (e) {
        likeBtn.classList.toggle('on', prevLike);
        dislikeBtn.classList.toggle('on', prevDis);
        paintRating();
        toast(e.message);
      }
    };
    likeBtn.onclick = () => {
      if (!likeBtn.classList.contains('on')) markEngaged(id);
      rate(likeBtn.classList.contains('on') ? 'none' : 'like');
    };
    dislikeBtn.onclick = () => rate(dislikeBtn.classList.contains('on') ? 'none' : 'dislike');
    slide.querySelector('.comments').onclick = () => openComments(id, slide._meta?.comments || '');
    slide.querySelector('.save').onclick = () => {
      const m = slide._meta || {};
      saveDialog({ id, title: m.title, thumbnail: `https://i.ytimg.com/vi/${id}/oar2.jpg`, channel: m.channel, short: true });
    };
    slide.querySelector('.share').onclick = () => {
      const m = slide._meta || {};
      if (navigator.share) navigator.share({ title: m.title, url: `https://youtube.com/shorts/${id}` }).catch(() => {});
      else shareDialog({ id, title: m.title });
    };
    slide.querySelector('.more').onclick = (e) => {
      const m = slide._meta || {};
      const v = { id, title: m.title, thumbnail: `https://i.ytimg.com/vi/${id}/oar2.jpg`, channel: m.channel, short: true };
      openMenu(e.currentTarget, [
        { icon: dislikeBtn.classList.contains('on') ? 'dislikeFilled' : 'dislike', label: dislikeBtn.classList.contains('on') ? '„Mag ich nicht“ entfernen' : 'Mag ich nicht', run: () => dislikeBtn.click() },
        { icon: video.muted ? 'volume' : 'volumeOff', label: video.muted ? 'Ton an' : 'Ton aus', run: toggleMute },
        { icon: 'download', label: 'Herunterladen', run: () => downloadDialog(v) },
        { icon: 'external', label: 'Als normales Video ansehen', run: () => go(`/watch?v=${id}`) }
      ]);
    };
  }

  // ---- Aktives Short ------------------------------------------------------------
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const slide = e.target;
      const idx = Number(slide.dataset.index);
      if (e.isIntersecting) fillSlide(slide, ids[idx]);
      if (e.isIntersecting && e.intersectionRatio >= 0.6 && idx !== active) activate(idx);
    }
  }, { root: scroller, threshold: [0, 0.6] });

  // ---- Schneller Start: ein Player für alle Shorts, der nächste wird vorgeladen ----------
  const streamCache = new Map(); // id -> Promise<streams>
  const preloads = new Map(); // id -> Promise<PreloadManager|null>
  const getStreams = (id) => {
    if (!streamCache.has(id)) streamCache.set(id, api(`/api/streams/${id}`, { signal }).catch((e) => (streamCache.delete(id), Promise.reject(e))));
    return streamCache.get(id);
  };
  const SHAKA_CONFIG = {
    streaming: { bufferingGoal: 12, rebufferingGoal: 0.4, bufferBehind: 10 },
    manifest: { dash: { ignoreMinBufferTime: true } },
    abr: { defaultBandwidthEstimate: 2_500_000 }
  };

  async function ensureShaka() {
    if (shakaPlayer || !window.shaka?.Player?.isBrowserSupported()) return shakaPlayer;
    window.shaka.polyfill.installAll();
    const p = new window.shaka.Player();
    await p.attach(video);
    p.configure(SHAKA_CONFIG);
    shakaPlayer = p;
    return p;
  }

  // Lädt Manifest und erste Segmente eines kommenden Shorts, während der aktuelle läuft.
  function preloadShort(id) {
    if (!id || preloads.has(id)) return;
    const promise = getStreams(id)
      .then(async (s) => {
        const p = await ensureShaka();
        if (!p || !s.dash || typeof p.preload !== 'function') return null;
        return p.preload(s.dash, 0, 'application/dash+xml');
      })
      .catch(() => null);
    preloads.set(id, promise);
    // Vorschaubild ebenfalls schon laden.
    const img = new Image();
    img.src = `https://i.ytimg.com/vi/${id}/oar2.jpg`;
  }

  function dropPreloads(keep) {
    for (const [id, pr] of preloads) {
      if (keep.includes(id)) continue;
      preloads.delete(id);
      pr.then((m) => m?.destroy?.()).catch(() => {});
    }
  }

  async function activate(idx) {
    active = idx;
    const id = ids[idx];
    const slide = scroller.children[idx];
    if (!slide) return;
    scroller.querySelectorAll('.short-slide.active').forEach((s) => s.classList.remove('active'));
    slide.classList.add('active', 'loading');
    slide.querySelector('.short-video-slot').appendChild(video);
    history.replaceState(history.state, '', `/shorts/${id}`);
    const token = ++loadToken;
    video.pause();
    // Sofort (parallel) die Stream-Infos der nächsten Shorts anfordern – günstig,
    // spart beim Weiterwischen die Wartezeit auf den Server.
    for (const n of [idx + 1, idx + 2, idx + 3]) if (ids[n]) getStreams(ids[n]).catch(() => {});
    try {
      const s = await getStreams(id);
      if (token !== loadToken) return;
      await attach(id, s, token);
      if (token !== loadToken) return;
      video.play().catch(() => {
        // Autoplay mit Ton blockiert → stumm versuchen.
        video.muted = true;
        video.play().catch(() => {});
      });
      api('/api/history', { method: 'POST', body: { video: { id, title: slide._meta?.title || '', thumbnail: `https://i.ytimg.com/vi/${id}/oar2.jpg`, channel: slide._meta?.channel || null, short: true } } }).catch(() => {});
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message);
    } finally {
      if (token === loadToken) slide.classList.remove('loading');
    }
    // Die nächsten zwei Shorts vorladen (Video + Infos), ältere Vorladungen freigeben.
    const upcoming = [ids[idx + 1], ids[idx + 2]].filter(Boolean);
    dropPreloads(upcoming);
    upcoming.forEach(preloadShort);
    for (const n of [idx + 1, idx + 2, idx + 3]) if (scroller.children[n]) fillSlide(scroller.children[n], ids[n]);
    if (idx >= ids.length - 5) fetchMore().catch(() => {});
  }

  async function attach(id, s, token) {
    video.removeAttribute('src');
    const p = await ensureShaka().catch(() => null);
    if (p && (s.dash || s.hls)) {
      const pre = preloads.get(id);
      preloads.delete(id);
      const manager = pre ? await pre : null;
      if (token !== loadToken) return;
      try {
        if (manager) await p.load(manager);
        else await p.load(s.dash || s.hls, 0, s.dash ? 'application/dash+xml' : 'application/x-mpegurl');
        return;
      } catch (e) {
        if (token !== loadToken) return;
        // Vorladung abgelaufen o. Ä. → normal laden.
        try {
          await p.load(s.dash || s.hls);
          return;
        } catch {}
      }
    }
    if (shakaPlayer) await shakaPlayer.unload().catch(() => {});
    const prog = [...(s.progressive || [])].sort((a, b) => parseInt(b.label) - parseInt(a.label));
    if (prog[0]) video.src = prog[0].url;
    else throw new Error('Keine abspielbare Quelle gefunden');
  }

  // Lernsignal: Was du likest oder fast ganz schaust, wird Startpunkt für die nächsten Shorts.
  const engaged = [];
  const markEngaged = (id) => {
    if (id && !engaged.includes(id)) engaged.push(id);
  };
  video.addEventListener('timeupdate', () => {
    const slide = scroller.children[active];
    if (slide && !slide.dataset.engaged && video.duration && video.currentTime / video.duration > 0.85) {
      slide.dataset.engaged = '1';
      markEngaged(ids[active]);
    }
  });

  video.addEventListener('timeupdate', () => {
    const slide = scroller.children[active];
    const bar = slide?.querySelector('.short-progress div');
    if (bar && video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
  });
  const syncPause = () => {
    reportPlaying(!video.paused);
    const slide = scroller.children[active];
    if (!slide) return;
    slide.classList.toggle('paused', video.paused);
  };
  video.addEventListener('play', syncPause);
  video.addEventListener('pause', syncPause);

  // Fortschrittsleiste: tippen zum Springen
  scroller.addEventListener('click', (e) => {
    const bar = e.target.closest('.short-progress');
    if (!bar || !video.duration) return;
    const r = bar.getBoundingClientRect();
    video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
  });

  // ---- Kommentare -------------------------------------------------------------------
  function openComments(id, count) {
    const layer = el(`<div class="dialog-layer shorts-comments-layer"><div class="dialog sheet-dialog"><div class="dialog-body"></div></div></div>`);
    document.getElementById('overlay-root').appendChild(layer);
    const ctl = new AbortController();
    const close = () => {
      ctl.abort();
      layer.remove();
    };
    layer.addEventListener('click', (e) => {
      if (e.target === layer) close();
    });
    const root = mountComments(layer.querySelector('.dialog-body'), { id }, { signal: ctl.signal, countHint: count });
    root.classList.add('open', 'in-sheet');
    root.querySelector('.comments-close').onclick = close;
  }

  // ---- Steuerung ------------------------------------------------------------------
  const scrollToIdx = (i) => scroller.children[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  node.querySelector('.shorts-up').onclick = () => scrollToIdx(Math.max(0, active - 1));
  node.querySelector('.shorts-down').onclick = () => scrollToIdx(active + 1);
  const onKey = (e) => {
    if (e.target.closest('input, textarea') || document.querySelector('.shorts-comments-layer, .dialog-layer')) return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      scrollToIdx(active + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      scrollToIdx(Math.max(0, active - 1));
    } else if (e.key === ' ') {
      e.preventDefault();
      video.paused ? video.play().catch(() => {}) : video.pause();
    } else if (e.key === 'm') {
      video.muted = !video.muted;
      localStorage.setItem('vl:shortsMuted', video.muted ? '1' : '0');
    }
  };
  document.addEventListener('keydown', onKey);
  const onVis = () => {
    if (document.hidden) video.pause();
  };
  document.addEventListener('visibilitychange', onVis);

  // Start
  if (params.id) addSlide(params.id);
  await fetchMore();
  if (!ids.length) {
    node.querySelector('.shorts-page').appendChild(el('<div class="empty-state"><h2>Keine Shorts gefunden</h2></div>'));
  }
  if (isMobile()) scroller.focus({ preventScroll: true });

  return () => {
    loadToken++;
    io.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    closeOverlay();
    document.querySelectorAll('.shorts-comments-layer').forEach((l) => l.remove());
    video.pause();
    reportPlaying(false);
    shakaPlayer?.destroy().catch(() => {});
    video.removeAttribute('src');
    video.load();
  };
}
