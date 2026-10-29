// Shorts: vertikal wischen, Endlos-Feed, Autoplay in Schleife.
import { api, el, html, raw, qs, compact } from '../util.js';
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
      if (cont) data = await api('/api/shorts' + qs({ cont }), { signal });
      else data = await api('/api/shorts' + qs({ seed: ids.length ? ids[ids.length - 1] : params.id }), { signal });
      cont = data.cont;
      const fresh = data.ids.filter((id) => !ids.includes(id));
      for (const id of fresh) addSlide(id);
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
          <button class="icon-btn short-playpause" aria-label="Wiedergabe">${raw(icon('pause'))}</button>
          <button class="icon-btn short-mute" aria-label="Ton">${raw(icon(video.muted ? 'volumeOff' : 'volume'))}</button>
        </div>
        <div class="short-paused-icon">${raw(icon('play'))}</div>
        <div class="short-bottom">
          <div class="short-channel"></div>
          <div class="short-caption"></div>
        </div>
        <div class="short-progress"><div></div></div>
      </div>
      <div class="short-actions">
        <button class="short-act like" aria-label="Mag ich">${raw(icon('likeFilled'))}<span class="like-count">Mag ich</span></button>
        <button class="short-act dislike" aria-label="Mag ich nicht">${raw(icon('dislikeFilled'))}<span>Mag ich nicht</span></button>
        <button class="short-act comments" aria-label="Kommentare">${raw(icon('comment'))}<span class="comment-count">Kommentare</span></button>
        <button class="short-act share" aria-label="Teilen">${raw(icon('share'))}<span>Teilen</span></button>
        <button class="short-act more" aria-label="Mehr">${raw(icon('moreH'))}</button>
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
    slide.querySelector('.short-caption').textContent = m.title;
    const ch = slide.querySelector('.short-channel');
    ch.innerHTML = '';
    ch.appendChild(el(html`<a href="/channel/${m.channel.id}" class="sc-link">${avatar(m.channel.avatar, 32, m.channel.name)}<span>@${m.channel.name.replace(/^@/, '')}</span></a>`));
    if (m.channel.id) ch.appendChild(subscribeButton({ id: m.channel.id, name: m.channel.name, avatar: m.channel.avatar }, m.subscribed));
    slide.querySelector('.like-count').textContent = m.likes != null ? compact(m.likes) : 'Mag ich';
    if (m.comments) slide.querySelector('.comment-count').textContent = m.comments;
    slide.querySelector('.like').classList.toggle('on', !!m.liked);
    slide.querySelector('.dislike').classList.toggle('on', !!m.disliked);
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
    slide.querySelector('.short-playpause').onclick = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    slide.querySelector('.short-mute').onclick = () => {
      video.muted = !video.muted;
      localStorage.setItem('vl:shortsMuted', video.muted ? '1' : '0');
      scroller.querySelectorAll('.short-mute').forEach((b) => (b.innerHTML = icon(video.muted ? 'volumeOff' : 'volume')));
    };
    const likeBtn = slide.querySelector('.like');
    const dislikeBtn = slide.querySelector('.dislike');
    const rate = async (r) => {
      const m = slide._meta || { title: '' };
      const v = { id, title: m.title, thumbnail: `https://i.ytimg.com/vi/${id}/oar2.jpg`, channel: m.channel, short: true };
      const prevLike = likeBtn.classList.contains('on');
      const prevDis = dislikeBtn.classList.contains('on');
      likeBtn.classList.toggle('on', r === 'like');
      dislikeBtn.classList.toggle('on', r === 'dislike');
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
        toast(e.message);
      }
    };
    likeBtn.onclick = () => rate(likeBtn.classList.contains('on') ? 'none' : 'like');
    dislikeBtn.onclick = () => rate(dislikeBtn.classList.contains('on') ? 'none' : 'dislike');
    slide.querySelector('.comments').onclick = () => openComments(id, slide._meta?.comments || '');
    slide.querySelector('.share').onclick = () => {
      const m = slide._meta || {};
      if (navigator.share) navigator.share({ title: m.title, url: `https://youtube.com/shorts/${id}` }).catch(() => {});
      else shareDialog({ id, title: m.title });
    };
    slide.querySelector('.more').onclick = (e) => {
      const m = slide._meta || {};
      const v = { id, title: m.title, thumbnail: `https://i.ytimg.com/vi/${id}/oar2.jpg`, channel: m.channel, short: true };
      openMenu(e.currentTarget, [
        { icon: 'save', label: 'In Playlist speichern', run: () => saveDialog(v) },
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
    try {
      const s = await api(`/api/streams/${id}`, { signal });
      if (token !== loadToken) return;
      await attach(s, token);
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
    // Nächste Shorts vorbereiten.
    if (ids[idx + 1]) api(`/api/streams/${ids[idx + 1]}`, { signal }).catch(() => {});
    if (idx >= ids.length - 4) fetchMore().catch(() => {});
  }

  async function attach(s, token) {
    if (shakaPlayer) {
      const p = shakaPlayer;
      shakaPlayer = null;
      await p.destroy().catch(() => {});
    }
    video.removeAttribute('src');
    if (window.shaka?.Player?.isBrowserSupported() && (s.dash || s.hls)) {
      window.shaka.polyfill.installAll();
      for (const url of [s.dash, s.hls].filter(Boolean)) {
        const p = new window.shaka.Player();
        try {
          await p.attach(video);
          p.configure({ streaming: { bufferingGoal: 20 }, abr: { defaultBandwidthEstimate: 3_000_000 } });
          await p.load(url);
          if (token !== loadToken) {
            await p.destroy();
            return;
          }
          shakaPlayer = p;
          return;
        } catch {
          await p.destroy().catch(() => {});
        }
      }
    }
    const prog = [...(s.progressive || [])].sort((a, b) => parseInt(b.label) - parseInt(a.label));
    if (prog[0]) video.src = prog[0].url;
    else throw new Error('Keine abspielbare Quelle gefunden');
  }

  video.addEventListener('timeupdate', () => {
    const slide = scroller.children[active];
    const bar = slide?.querySelector('.short-progress div');
    if (bar && video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
  });
  const syncPause = () => {
    const slide = scroller.children[active];
    if (!slide) return;
    slide.classList.toggle('paused', video.paused);
    slide.querySelector('.short-playpause').innerHTML = icon(video.paused ? 'play' : 'pause');
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
      scroller.children[active]?.querySelector('.short-mute').click();
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
    shakaPlayer?.destroy().catch(() => {});
    video.removeAttribute('src');
    video.load();
  };
}
