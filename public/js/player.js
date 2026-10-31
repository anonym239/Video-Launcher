// Der Videoplayer: eigene YouTube-ähnliche Steuerung auf Basis von <video> + Shaka (DASH/HLS).
import { api, formatTime, el, html, raw, throttle, reportPlaying } from './util.js';
import { icon } from './icons.js';
import { state, setPosition, emit } from './state.js';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let shakaReady = false;

function ensureShaka() {
  if (!window.shaka) return false;
  if (!shakaReady) {
    window.shaka.polyfill.installAll();
    shakaReady = true;
  }
  return window.shaka.Player.isBrowserSupported();
}

export class Player {
  constructor() {
    this.root = el(html`
      <div class="player" tabindex="0" data-state="idle">
        <video class="p-video" playsinline preload="auto"></video>
        <div class="p-poster"></div>
        <div class="p-spinner"><div class="spinner big"></div></div>
        <div class="p-feedback" aria-hidden="true"></div>
        <div class="p-seek-ripple left"><div>${raw(icon('prev'))}<span>10 Sekunden</span></div></div>
        <div class="p-seek-ripple right"><div>${raw(icon('next'))}<span>10 Sekunden</span></div></div>
        <div class="p-speed-badge">2x ${raw(icon('next'))}</div>
        <div class="p-error" hidden></div>
        <div class="p-endscreen" hidden></div>
        <div class="p-controls">
          <div class="p-top">
            <div class="p-title"></div>
            <button class="p-btn p-mini-close" data-act="close" aria-label="Schließen">${raw(icon('close'))}</button>
          </div>
          <div class="p-center">
            <button class="p-btn p-big p-prev" data-act="prev" aria-label="Vorheriges">${raw(icon('prev'))}</button>
            <button class="p-btn p-big p-play-big" data-act="play" aria-label="Wiedergabe">${raw(icon('play'))}</button>
            <button class="p-btn p-big p-next" data-act="next" aria-label="Nächstes">${raw(icon('next'))}</button>
          </div>
          <div class="p-bottom">
            <div class="p-progress" role="slider" aria-label="Suchleiste" tabindex="-1">
              <svg class="p-heat" preserveAspectRatio="none" viewBox="0 0 1000 100"><path></path></svg>
              <div class="p-segments"></div>
              <div class="p-hover-preview"><div class="p-sb"></div><div class="p-hover-chapter"></div><div class="p-hover-time"></div></div>
              <div class="p-scrubber"></div>
            </div>
            <div class="p-bar">
              <div class="p-left">
                <button class="p-btn p-play" data-act="play" aria-label="Wiedergabe (k)">${raw(icon('play'))}</button>
                <button class="p-btn p-next-small" data-act="next" aria-label="Nächstes (Umschalt+N)">${raw(icon('next'))}</button>
                <div class="p-volume">
                  <button class="p-btn p-mute" data-act="mute" aria-label="Stummschalten (m)">${raw(icon('volume'))}</button>
                  <input class="p-vol-slider" type="range" min="0" max="1" step="0.05" value="1" aria-label="Lautstärke">
                </div>
                <div class="p-time"><span class="p-cur">0:00</span> / <span class="p-dur">0:00</span></div>
                <button class="p-chapter-btn" data-act="chapters"></button>
                <span class="p-live-badge" hidden>LIVE</span>
              </div>
              <div class="p-right">
                <label class="p-autoplay" title="Autoplay"><input type="checkbox" class="p-autoplay-input"><span class="p-switch"></span></label>
                <button class="p-btn p-cc" data-act="cc" aria-label="Untertitel (c)">${raw(icon('cc'))}</button>
                <button class="p-btn p-settings-btn" data-act="settings" aria-label="Einstellungen">${raw(icon('gear'))}</button>
                <button class="p-btn p-pip" data-act="pip" aria-label="Bild-in-Bild">${raw(icon('pip'))}</button>
                <button class="p-btn p-theater" data-act="theater" aria-label="Kinomodus (t)">${raw(icon('theater'))}</button>
                <button class="p-btn p-fs" data-act="fullscreen" aria-label="Vollbild (f)">${raw(icon('fullscreen'))}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="p-mini-bar">
          <div class="p-mini-info"><div class="p-mini-title"></div><div class="p-mini-channel"></div></div>
          <button class="p-btn" data-act="play" aria-label="Wiedergabe">${raw(icon('play'))}</button>
          <button class="p-btn" data-act="close" aria-label="Schließen">${raw(icon('close'))}</button>
        </div>
        <div class="p-menu" hidden></div>
      </div>`);
    this.video = this.root.querySelector('video');
    this.q = (s) => this.root.querySelector(s);
    this.shaka = null;
    this.meta = null; // { id, title, channel, ... }
    this.streams = null;
    this.chapters = [];
    this.heat = [];
    this.storyboard = null;
    this.loadToken = 0;
    this.hooks = {}; // onEnded, onNext, onPrev, onClose, onExpand
    this.hideTimer = null;
    this.quality = 'auto';
    this.captionLang = null;
    this.loop = false;
    this.mode = 'full';

    const savedVol = Number(localStorage.getItem('vl:volume') ?? 1);
    this.video.volume = isFinite(savedVol) ? savedVol : 1;
    this.video.muted = localStorage.getItem('vl:muted') === '1';
    this.#bind();
  }

  // ---- Laden ------------------------------------------------------------------
  async load(meta, { startAt = 0, autoplay = true } = {}) {
    const token = ++this.loadToken;
    this.meta = meta;
    this.chapters = [];
    this.heat = [];
    this.storyboard = null;
    this.#hideEndscreen();
    this.#setError(null);
    this.root.dataset.state = 'loading';
    this.q('.p-title').textContent = meta.title || '';
    this.q('.p-mini-title').textContent = meta.title || '';
    this.q('.p-mini-channel').textContent = meta.channel?.name || '';
    this.q('.p-poster').style.backgroundImage = `url("https://i.ytimg.com/vi/${meta.id}/hqdefault.jpg")`;
    this.root.classList.add('show-poster');
    this.#renderSegments();
    this.#updateMediaSession();
    await this.#teardown();
    if (token !== this.loadToken) return;

    let streams;
    try {
      streams = await api(`/api/streams/${meta.id}`);
    } catch (e) {
      if (token === this.loadToken) this.#setError(e.message);
      return;
    }
    if (token !== this.loadToken) return;
    this.streams = streams;
    this.storyboard = streams.storyboard;
    this.root.classList.toggle('is-live', !!streams.live);
    this.q('.p-live-badge').hidden = !streams.live;
    if (!this.meta.title && streams.title) {
      this.meta.title = streams.title;
      this.q('.p-title').textContent = streams.title;
      this.q('.p-mini-title').textContent = streams.title;
    }
    await this.#attach(streams, startAt, token);
    if (token !== this.loadToken) return;
    this.#addCaptions(streams.captions || []);
    this.video.playbackRate = Number(state.settings.speed) || 1;
    if (autoplay) this.play();
  }

  async #attach(streams, startAt, token) {
    const sources = [];
    if (streams.dash) sources.push({ url: streams.dash, mime: 'application/dash+xml' });
    if (streams.hls) sources.push({ url: streams.hls, mime: 'application/x-mpegurl' });
    if (ensureShaka()) {
      for (const src of sources) {
        const p = new window.shaka.Player();
        try {
          await p.attach(this.video);
          p.configure({
            streaming: {
              bufferingGoal: 40,
              rebufferingGoal: 1.5,
              bufferBehind: 20,
              retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 20000 }
            },
            abr: { enabled: true, defaultBandwidthEstimate: 3_000_000 },
            preferredAudioLanguage: state.settings.lang || 'de',
            preferredVariantRole: 'main'
          });
          p.addEventListener('error', (ev) => this.#onShakaError(ev.detail));
          p.addEventListener('adaptation', () => this.#refreshQualityLabel());
          await p.load(src.url, streams.live ? null : startAt || 0, src.mime);
          if (token !== this.loadToken) {
            await p.destroy();
            return;
          }
          this.shaka = p;
          this.source = 'shaka';
          this.#applyDefaultQuality();
          return;
        } catch (e) {
          console.warn('Shaka konnte Quelle nicht laden', src.url, e);
          await p.destroy().catch(() => {});
        }
      }
    }
    // Fallback: progressive MP4 (meist 360p) oder natives HLS (Safari).
    const prog = [...(streams.progressive || [])].sort((a, b) => parseInt(b.label) - parseInt(a.label));
    if (prog.length) {
      this.source = 'progressive';
      this.video.src = prog[0].url;
      this.progressiveLabel = prog[0].label;
    } else if (streams.hls && this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.source = 'native-hls';
      this.video.src = streams.hls;
    } else {
      this.#setError('Für dieses Video wurde keine abspielbare Quelle gefunden.');
      return;
    }
    if (startAt) {
      const seek = () => {
        this.video.currentTime = startAt;
      };
      this.video.addEventListener('loadedmetadata', seek, { once: true });
    }
  }

  async #teardown() {
    this.video.pause();
    for (const t of [...this.video.querySelectorAll('track')]) t.remove();
    if (this.shaka) {
      const p = this.shaka;
      this.shaka = null;
      try {
        await p.destroy();
      } catch {}
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  #onShakaError(err) {
    if (!err) return;
    console.warn('Shaka-Fehler', err);
    // 1001 = BAD_HTTP_STATUS, 1002 = HTTP_ERROR (z. B. abgelaufene URL) → Streams neu holen.
    if (err.severity === 2 && this.meta && !this.retried) {
      this.retried = true;
      const t = this.video.currentTime;
      api(`/api/streams/${this.meta.id}?fresh=1`).then(() => this.load(this.meta, { startAt: t })).catch(() => this.#setError('Wiedergabefehler'));
    } else if (err.severity === 2) {
      this.#setError('Wiedergabefehler (Code ' + err.code + ')');
    }
  }

  #setError(msg) {
    const box = this.q('.p-error');
    if (!msg) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = '';
    box.append(el(`<div class="p-error-icon">${icon('info')}</div>`));
    const p = document.createElement('p');
    p.textContent = msg;
    box.append(p);
    const retry = el('<button class="btn btn-outline">Erneut versuchen</button>');
    retry.onclick = () => {
      this.retried = false;
      api(`/api/streams/${this.meta.id}?fresh=1`).catch(() => {}).finally(() => this.load(this.meta, { startAt: this.video.currentTime }));
    };
    box.append(retry);
    this.root.dataset.state = 'error';
  }

  // ---- Untertitel -------------------------------------------------------------------
  #addCaptions(captions) {
    for (const c of captions) {
      const t = document.createElement('track');
      t.kind = 'subtitles';
      t.label = c.label;
      t.srclang = c.lang;
      t.src = c.url;
      this.video.appendChild(t);
    }
    const tracks = [...this.video.textTracks].filter((t) => t.label !== 'Shaka Player TextTrack');
    for (const t of tracks) t.mode = 'disabled';
    const want = state.settings.captions || this.captionLang;
    if (want && captions.length) {
      const lang = typeof want === 'string' ? want : state.settings.lang;
      const idx = Math.max(0, captions.findIndex((c) => c.lang === lang && !c.auto));
      this.setCaption(captions[idx]?.lang ?? null, idx);
    }
    this.q('.p-cc').classList.toggle('disabled', !captions.length);
    this.q('.p-cc').classList.remove('on');
  }

  setCaption(lang, index) {
    const tracks = [...this.video.querySelectorAll('track')];
    tracks.forEach((t, i) => {
      t.track.mode = lang != null && i === index ? 'showing' : 'disabled';
    });
    this.captionLang = lang;
    this.q('.p-cc').classList.toggle('on', lang != null);
  }

  toggleCaptions() {
    const caps = this.streams?.captions || [];
    if (!caps.length) return this.#flash('cc', 'Keine Untertitel verfügbar');
    if (this.captionLang != null) {
      this.setCaption(null);
      this.#flash('cc', 'Untertitel aus');
    } else {
      let idx = caps.findIndex((c) => c.lang === (state.settings.lang || 'de') && !c.auto);
      if (idx < 0) idx = caps.findIndex((c) => !c.auto);
      if (idx < 0) idx = 0;
      this.setCaption(caps[idx].lang, idx);
      this.#flash('cc', caps[idx].label);
    }
  }

  // ---- Qualität ---------------------------------------------------------------------
  #qualities() {
    if (this.shaka) {
      const tracks = this.shaka.getVariantTracks();
      const heights = [...new Set(tracks.filter((t) => t.height).map((t) => t.height))].sort((a, b) => b - a);
      return heights.map((h) => ({ value: String(h), label: `${h}p${h >= 1440 ? (h >= 2160 ? ' 4K' : ' HD') : h >= 720 ? ' HD' : ''}` }));
    }
    return (this.streams?.progressive || []).map((p) => ({ value: p.label, label: p.label }));
  }

  #applyDefaultQuality() {
    const pref = state.settings.quality || 'auto';
    if (pref === 'auto' || !this.shaka) return;
    this.setQuality(pref, true);
  }

  setQuality(value, isDefault = false) {
    this.quality = value;
    if (this.shaka) {
      if (value === 'auto') {
        this.shaka.configure({ abr: { enabled: true } });
      } else {
        const max = Number(value);
        const tracks = this.shaka.getVariantTracks().filter((t) => t.height && t.height <= max);
        if (!tracks.length) return;
        const best = Math.max(...tracks.map((t) => t.height));
        const active = this.shaka.getVariantTracks().find((t) => t.active);
        const cands = tracks.filter((t) => t.height === best);
        const pick = cands.find((t) => active && t.language === active.language && t.audioId === active.audioId) || cands.sort((a, b) => b.bandwidth - a.bandwidth)[0];
        this.shaka.configure({ abr: { enabled: false } });
        this.shaka.selectVariantTrack(pick, !isDefault);
      }
    } else if (this.source === 'progressive') {
      const f = this.streams.progressive.find((p) => p.label === value);
      if (f && this.video.src !== f.url) {
        const t = this.video.currentTime;
        const playing = !this.video.paused;
        this.video.src = f.url;
        this.video.addEventListener('loadedmetadata', () => {
          this.video.currentTime = t;
          if (playing) this.play();
        }, { once: true });
      }
    }
    this.#refreshQualityLabel();
  }

  #currentQualityLabel() {
    if (this.shaka) {
      const active = this.shaka.getVariantTracks().find((t) => t.active);
      const h = active?.height ? `${active.height}p` : '';
      return this.quality === 'auto' ? `Automatisch${h ? ` (${h})` : ''}` : h;
    }
    return this.progressiveLabel || '';
  }

  #refreshQualityLabel() {
    const hd = this.shaka?.getVariantTracks().find((t) => t.active)?.height >= 720;
    this.q('.p-settings-btn').classList.toggle('hd', !!hd);
  }

  // ---- Steuerung ----------------------------------------------------------------------
  play() {
    const p = this.video.play();
    if (p?.catch) {
      p.catch((e) => {
        if (e.name === 'NotAllowedError') {
          // Autoplay blockiert → stumm starten wie YouTube.
          this.root.dataset.state = 'paused';
        }
      });
    }
  }

  togglePlay() {
    if (this.video.ended) {
      this.video.currentTime = 0;
      this.play();
    } else if (this.video.paused) this.play();
    else this.video.pause();
  }

  seek(t, flash) {
    const d = this.duration();
    this.video.currentTime = Math.max(0, d ? Math.min(t, d - 0.1) : t);
    if (flash) this.#showControls();
  }

  seekBy(delta) {
    this.seek(this.video.currentTime + delta);
  }

  duration() {
    const d = this.video.duration;
    if (isFinite(d) && d > 0) return d;
    if (this.shaka && this.streams?.live) {
      const r = this.shaka.seekRange();
      return r.end;
    }
    return this.streams?.duration || this.meta?.duration || 0;
  }

  setChapters(chapters) {
    this.chapters = chapters || [];
    this.#renderSegments();
  }

  setHeat(heat) {
    this.heat = heat || [];
    this.#renderHeat();
  }

  setHooks(h) {
    this.hooks = h || {};
    // Große Buttons nur unsichtbar machen, damit Play mittig bleibt.
    this.q('.p-next').style.visibility = this.hooks.onNext ? '' : 'hidden';
    this.q('.p-prev').style.visibility = this.hooks.onPrev ? '' : 'hidden';
    this.q('.p-next-small').hidden = !this.hooks.onNext;
    this.#updateMediaSession();
  }

  setMode(mode) {
    this.mode = mode;
    this.root.classList.toggle('mini', mode === 'mini');
    this.#closeMenu();
  }

  async fullscreen(force) {
    const isFs = !!document.fullscreenElement;
    const want = force ?? !isFs;
    try {
      if (want && !isFs) {
        await (this.root.requestFullscreen?.({ navigationUI: 'hide' }) || this.video.webkitEnterFullscreen?.());
        const v = this.video;
        if (v.videoWidth >= v.videoHeight) screen.orientation?.lock?.('landscape').catch(() => {});
      } else if (!want && isFs) {
        await document.exitFullscreen();
        screen.orientation?.unlock?.();
      }
    } catch {}
  }

  async pip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch (e) {
      this.#flash('pip', 'Bild-in-Bild wird nicht unterstützt');
    }
  }

  stop() {
    this.loadToken++;
    this.#savePosition(true);
    this.#teardown();
    this.meta = null;
    this.root.dataset.state = 'idle';
    navigator.mediaSession && (navigator.mediaSession.metadata = null);
  }

  // ---- Darstellung --------------------------------------------------------------------
  #renderSegments() {
    const box = this.q('.p-segments');
    box.innerHTML = '';
    const d = this.duration() || this.meta?.duration || 0;
    const chapters = d && this.chapters.length > 1 ? this.chapters : [{ start: 0, title: '' }];
    chapters.forEach((c, i) => {
      const end = chapters[i + 1]?.start ?? d;
      const w = d ? ((end - c.start) / d) * 100 : 100;
      const seg = el(`<div class="p-seg" style="width:${w}%"><div class="p-seg-buf"></div><div class="p-seg-play"></div></div>`);
      seg.dataset.start = c.start;
      seg.dataset.end = end;
      box.appendChild(seg);
    });
    this.root.classList.toggle('has-chapters', chapters.length > 1);
    this.#updateProgress();
    this.#renderHeat();
  }

  #renderHeat() {
    const path = this.q('.p-heat path');
    if (!this.heat.length) {
      path.setAttribute('d', '');
      return;
    }
    const d = this.duration() || this.heat[this.heat.length - 1][0] || 1;
    let p = 'M0,100';
    for (const [t, v] of this.heat) p += ` L${((t / d) * 1000).toFixed(1)},${(100 - v * 100).toFixed(1)}`;
    p += ' L1000,100 Z';
    path.setAttribute('d', p);
  }

  #updateProgress() {
    const v = this.video;
    const d = this.duration();
    const cur = v.currentTime || 0;
    let bufEnd = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= cur + 1) bufEnd = Math.max(bufEnd, v.buffered.end(i));
    }
    for (const seg of this.q('.p-segments').children) {
      const s = Number(seg.dataset.start);
      const e = Number(seg.dataset.end) || d;
      const len = e - s || 1;
      seg.lastChild.style.transform = `scaleX(${Math.max(0, Math.min(1, (cur - s) / len))})`;
      seg.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, (bufEnd - s) / len))})`;
    }
    this.q('.p-scrubber').style.left = d ? `${(cur / d) * 100}%` : '0';
    this.q('.p-cur').textContent = formatTime(cur);
    this.q('.p-dur').textContent = formatTime(d);
    const ch = this.#chapterAt(cur);
    const cb = this.q('.p-chapter-btn');
    cb.textContent = ch ? `• ${ch.title} ›` : '';
    cb.hidden = !ch;
  }

  #chapterAt(t) {
    if (this.chapters.length < 2) return null;
    let found = null;
    for (const c of this.chapters) if (c.start <= t) found = c;
    return found;
  }

  #flash(iconName, text) {
    const f = this.q('.p-feedback');
    f.innerHTML = `${icon(iconName)}${text ? `<span>${text.replace(/[<>&]/g, '')}</span>` : ''}`;
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
  }

  #showControls() {
    this.root.classList.add('controls-visible');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.video.paused && !this.root.querySelector('.p-menu:not([hidden])') && !this.dragging) {
        this.root.classList.remove('controls-visible');
      }
    }, 3000);
  }

  #hideControls() {
    clearTimeout(this.hideTimer);
    if (!this.video.paused) this.root.classList.remove('controls-visible');
  }

  // ---- Einstellungsmenü ------------------------------------------------------------
  #openMenu(panel = 'main') {
    const menu = this.q('.p-menu');
    menu.hidden = false;
    menu.innerHTML = '';
    const item = (iconName, label, value, fn) => {
      const b = el(html`<button class="p-menu-item">${iconName ? raw(icon(iconName)) : ''}<span class="pm-label">${label}</span><span class="pm-value">${value || ''}</span>${fn.sub ? raw(icon('right', 'pm-arrow')) : ''}</button>`);
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      menu.appendChild(b);
      return b;
    };
    const header = (title) => {
      const b = el(html`<button class="p-menu-header">${raw(icon('left'))}<span>${title}</span></button>`);
      b.onclick = (e) => {
        e.stopPropagation();
        this.#openMenu('main');
      };
      menu.appendChild(b);
    };
    const option = (label, active, fn) => {
      const b = el(html`<button class="p-menu-item option ${active ? 'active' : ''}">${raw(active ? icon('check') : '<span class="icon"></span>')}<span class="pm-label">${label}</span></button>`);
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
        this.#closeMenu();
      };
      menu.appendChild(b);
    };
    if (panel === 'main') {
      const sub = (fn) => Object.assign(fn, { sub: true });
      const caps = this.streams?.captions || [];
      const capLabel = this.captionLang != null ? caps.find((c) => c.lang === this.captionLang)?.label || 'An' : 'Aus';
      item('cc', 'Untertitel', `${capLabel} (${caps.length})`, sub(() => this.#openMenu('captions')));
      item('speed', 'Wiedergabegeschwindigkeit', this.video.playbackRate === 1 ? 'Standard' : `${this.video.playbackRate}`, sub(() => this.#openMenu('speed')));
      item('hd', 'Qualität', this.#currentQualityLabel(), sub(() => this.#openMenu('quality')));
      if (this.shaka && this.shaka.getAudioLanguagesAndRoles().length > 1) {
        item('music', 'Audiotrack', this.shaka.getVariantTracks().find((t) => t.active)?.language || '', sub(() => this.#openMenu('audio')));
      }
      item('repeat', 'Schleife', this.loop ? 'An' : 'Aus', () => {
        this.loop = !this.loop;
        this.video.loop = this.loop;
        this.#closeMenu();
        this.#flash('repeat', this.loop ? 'Schleife an' : 'Schleife aus');
      });
    } else if (panel === 'speed') {
      header('Wiedergabegeschwindigkeit');
      for (const s of SPEEDS) option(s === 1 ? 'Standard' : String(s).replace('.', ','), this.video.playbackRate === s, () => (this.video.playbackRate = s));
    } else if (panel === 'quality') {
      header('Qualität');
      const qs = this.#qualities();
      if (this.shaka) option(`Automatisch${this.quality === 'auto' ? ` (${this.shaka.getVariantTracks().find((t) => t.active)?.height || '?'}p)` : ''}`, this.quality === 'auto', () => this.setQuality('auto'));
      for (const qOpt of qs) option(qOpt.label, this.quality === qOpt.value || (this.source === 'progressive' && this.progressiveLabel === qOpt.value), () => {
        this.progressiveLabel = this.source === 'progressive' ? qOpt.value : this.progressiveLabel;
        this.setQuality(qOpt.value);
      });
    } else if (panel === 'captions') {
      header('Untertitel');
      option('Aus', this.captionLang == null, () => this.setCaption(null));
      (this.streams?.captions || []).forEach((c, i) => option(c.label, this.captionLang === c.lang, () => this.setCaption(c.lang, i)));
    } else if (panel === 'audio') {
      header('Audiotrack');
      const active = this.shaka.getVariantTracks().find((t) => t.active);
      for (const lr of this.shaka.getAudioLanguagesAndRoles()) {
        option(`${lr.language}${lr.role ? ` (${lr.role})` : ''}`, active?.language === lr.language, () => this.shaka.selectAudioLanguage(lr.language, lr.role));
      }
    }
    this.root.classList.add('menu-open');
  }

  #closeMenu() {
    const menu = this.q('.p-menu');
    if (menu) menu.hidden = true;
    this.root.classList.remove('menu-open');
  }

  // ---- Endbildschirm (nächstes Video) ---------------------------------------------
  showUpNext(next, onGo) {
    const box = this.q('.p-endscreen');
    clearInterval(this.upNextTimer);
    if (!next) return;
    let n = 8;
    box.hidden = false;
    box.innerHTML = html`<div class="upnext">
      <div class="upnext-label">Nächstes Video in <b class="upnext-count">${n}</b></div>
      <div class="upnext-card"><img src="https://i.ytimg.com/vi/${next.id}/mqdefault.jpg" alt=""><div><div class="upnext-title">${next.title || ''}</div><div class="upnext-ch">${next.channel?.name || ''}</div></div></div>
      <div class="upnext-actions"><button class="btn btn-dark upnext-cancel">Abbrechen</button><button class="btn btn-light upnext-play">Jetzt abspielen</button></div>
    </div>`.toString();
    const go = () => {
      clearInterval(this.upNextTimer);
      this.#hideEndscreen();
      onGo();
    };
    box.querySelector('.upnext-play').onclick = go;
    box.querySelector('.upnext-card').onclick = go;
    box.querySelector('.upnext-cancel').onclick = () => {
      clearInterval(this.upNextTimer);
      this.#hideEndscreen();
      this.root.dataset.state = 'ended';
    };
    this.upNextTimer = setInterval(() => {
      n--;
      const c = box.querySelector('.upnext-count');
      if (c) c.textContent = n;
      if (n <= 0) go();
    }, 1000);
  }

  #hideEndscreen() {
    clearInterval(this.upNextTimer);
    const box = this.q('.p-endscreen');
    box.hidden = true;
    box.innerHTML = '';
  }

  // ---- Sperrbildschirm / Benachrichtigung (Media Session) -------------------------
  #updateMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms || !this.meta) return;
    try {
      ms.metadata = new window.MediaMetadata({
        title: this.meta.title || '',
        artist: this.meta.channel?.name || '',
        artwork: [
          { src: `https://i.ytimg.com/vi/${this.meta.id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
          { src: `https://i.ytimg.com/vi/${this.meta.id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }
        ]
      });
      ms.setActionHandler('play', () => this.play());
      ms.setActionHandler('pause', () => this.video.pause());
      ms.setActionHandler('seekbackward', () => this.seekBy(-10));
      ms.setActionHandler('seekforward', () => this.seekBy(10));
      ms.setActionHandler('seekto', (d) => this.seek(d.seekTime));
      ms.setActionHandler('nexttrack', this.hooks.onNext ? () => this.hooks.onNext() : null);
      ms.setActionHandler('previoustrack', this.hooks.onPrev ? () => this.hooks.onPrev() : null);
    } catch {}
  }

  #savePosition(force) {
    if (!this.meta || this.streams?.live) return;
    const t = this.video.currentTime;
    const d = this.duration();
    if (!force && t < 5) return;
    setPosition(this.meta.id, t, d);
    api('/api/position', { method: 'POST', body: { id: this.meta.id, t, d } }).catch(() => {});
  }

  // ---- Ereignisse -------------------------------------------------------------------
  #bind() {
    const v = this.video;
    const r = this.root;
    const saveThrottled = throttle(() => this.#savePosition(false), 10000);

    v.addEventListener('play', () => {
      r.dataset.state = 'playing';
      r.classList.remove('show-poster');
      this.#setIcons();
      this.#showControls();
      emit('player:play', this.meta);
      reportPlaying(true);
    });
    v.addEventListener('playing', () => {
      r.dataset.state = 'playing';
      r.classList.remove('show-poster', 'buffering');
    });
    v.addEventListener('pause', () => {
      if (r.dataset.state !== 'error') r.dataset.state = v.ended ? 'ended' : 'paused';
      this.#setIcons();
      r.classList.add('controls-visible');
      this.#savePosition(true);
      emit('player:pause', this.meta);
      reportPlaying(false);
    });
    v.addEventListener('waiting', () => r.classList.add('buffering'));
    v.addEventListener('canplay', () => r.classList.remove('buffering'));
    v.addEventListener('loadedmetadata', () => {
      this.#renderSegments();
      this.retried = false;
    });
    v.addEventListener('timeupdate', () => {
      this.#updateProgress();
      saveThrottled();
    });
    v.addEventListener('progress', () => this.#updateProgress());
    v.addEventListener('volumechange', () => {
      localStorage.setItem('vl:volume', String(v.volume));
      localStorage.setItem('vl:muted', v.muted ? '1' : '0');
      this.q('.p-vol-slider').value = v.muted ? 0 : v.volume;
      this.#setIcons();
    });
    v.addEventListener('ratechange', () => {
      if (v.playbackRate !== 2 || !this.longPress) state.settings.speed = v.playbackRate;
    });
    v.addEventListener('ended', () => {
      r.dataset.state = 'ended';
      this.#setIcons();
      if (this.meta) {
        setPosition(this.meta.id, 0, 0);
        api('/api/position', { method: 'POST', body: { id: this.meta.id, t: 0, d: 0 } }).catch(() => {});
      }
      this.hooks.onEnded?.();
    });
    v.addEventListener('error', () => {
      if (this.source === 'progressive' && v.error && this.meta) this.#setError('Das Video konnte nicht geladen werden.');
    });

    // Buttons
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !r.contains(b)) return;
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === 'play') this.togglePlay();
      else if (act === 'next') this.hooks.onNext?.();
      else if (act === 'prev') this.hooks.onPrev?.();
      else if (act === 'mute') v.muted = !v.muted;
      else if (act === 'fullscreen') this.fullscreen();
      else if (act === 'pip') this.pip();
      else if (act === 'theater') emit('player:theater');
      else if (act === 'cc') this.toggleCaptions();
      else if (act === 'chapters') emit('player:chapters');
      else if (act === 'close') this.hooks.onClose?.();
      else if (act === 'settings') {
        if (this.q('.p-menu').hidden) this.#openMenu('main');
        else this.#closeMenu();
      }
      this.#showControls();
    });

    const autoplay = this.q('.p-autoplay-input');
    autoplay.checked = state.settings.autoplay !== false;
    autoplay.addEventListener('change', () => {
      state.settings.autoplay = autoplay.checked;
      api('/api/settings', { method: 'POST', body: { autoplay: autoplay.checked } }).catch(() => {});
      this.#flash(autoplay.checked ? 'play' : 'pause', autoplay.checked ? 'Autoplay ist an' : 'Autoplay ist aus');
    });

    this.q('.p-vol-slider').addEventListener('input', (e) => {
      v.volume = Number(e.target.value);
      v.muted = v.volume === 0;
    });

    // Klick/Tippen auf das Video
    let lastTap = 0;
    let tapTimer = null;
    const surface = (e) => !e.target.closest('.p-bar, .p-progress, .p-menu, .p-btn, .p-endscreen, .p-error, .p-mini-bar, .p-chapter-btn, .p-autoplay');
    r.addEventListener('click', (e) => {
      if (!surface(e)) return;
      if (this.mode === 'mini') {
        this.hooks.onExpand?.();
        return;
      }
      if (this.longPressed) {
        this.longPressed = false;
        return;
      }
      if (!this.q('.p-menu').hidden) {
        this.#closeMenu();
        return;
      }
      const touch = matchMedia('(pointer: coarse)').matches;
      const now = Date.now();
      const rect = r.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        lastTap = 0;
        if (touch && (x < 0.35 || x > 0.65)) {
          const right = x > 0.65;
          this.seekBy(right ? 10 : -10);
          const rip = this.q(`.p-seek-ripple.${right ? 'right' : 'left'}`);
          rip.classList.remove('show');
          void rip.offsetWidth;
          rip.classList.add('show');
        } else {
          this.fullscreen();
        }
        return;
      }
      lastTap = now;
      tapTimer = setTimeout(() => {
        if (touch) {
          if (r.classList.contains('controls-visible') && !v.paused) this.#hideControls();
          else this.#showControls();
        } else {
          this.togglePlay();
          this.#flash(v.paused ? 'pause' : 'play');
        }
      }, touch ? 250 : 200);
    });

    // Gedrückt halten = 2x Geschwindigkeit
    let pressTimer = null;
    let prevRate = 1;
    r.addEventListener('pointerdown', (e) => {
      if (!surface(e) || this.mode === 'mini' || this.streams?.live) return;
      pressTimer = setTimeout(() => {
        if (v.paused) return;
        this.longPress = true;
        this.longPressed = true;
        prevRate = v.playbackRate;
        v.playbackRate = 2;
        r.classList.add('fast');
      }, 550);
    });
    const endPress = () => {
      clearTimeout(pressTimer);
      if (this.longPress) {
        v.playbackRate = prevRate;
        this.longPress = false;
        r.classList.remove('fast');
      }
    };
    r.addEventListener('pointerup', endPress);
    r.addEventListener('pointercancel', endPress);
    r.addEventListener('pointerleave', endPress);
    r.addEventListener('contextmenu', (e) => {
      if (matchMedia('(pointer: coarse)').matches) e.preventDefault();
    });

    r.addEventListener('mousemove', () => this.#showControls());
    r.addEventListener('mouseleave', () => this.#hideControls());

    // Suchleiste
    const bar = this.q('.p-progress');
    const preview = this.q('.p-hover-preview');
    const timeAt = (clientX) => {
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return { t: x * this.duration(), x, rect };
    };
    const showPreview = (clientX) => {
      const { t, x, rect } = timeAt(clientX);
      preview.classList.add('show');
      this.q('.p-hover-time').textContent = formatTime(t);
      const ch = this.#chapterAt(t);
      this.q('.p-hover-chapter').textContent = ch?.title || '';
      const sb = this.q('.p-sb');
      const s = this.storyboard;
      if (s && s.template) {
        const count = s.count || 1;
        const per = s.columns * s.rows;
        const interval = s.interval ? s.interval / 1000 : this.duration() / count;
        const idx = Math.min(count - 1, Math.floor(t / (interval || 1)));
        const sheet = Math.floor(idx / per);
        const inSheet = idx % per;
        const col = inSheet % s.columns;
        const row = Math.floor(inSheet / s.columns);
        const scale = 160 / s.width;
        sb.style.display = 'block';
        sb.style.width = `${s.width * scale}px`;
        sb.style.height = `${s.height * scale}px`;
        sb.style.backgroundImage = `url("${s.template.replace('$M', sheet)}")`;
        sb.style.backgroundSize = `${s.columns * s.width * scale}px ${s.rows * s.height * scale}px`;
        sb.style.backgroundPosition = `-${col * s.width * scale}px -${row * s.height * scale}px`;
      } else {
        sb.style.display = 'none';
      }
      const w = preview.offsetWidth;
      const left = Math.max(0, Math.min(rect.width - w, x * rect.width - w / 2));
      preview.style.left = `${left}px`;
      this.q('.p-segments').querySelectorAll('.p-seg').forEach((seg) => seg.classList.toggle('hover', t >= Number(seg.dataset.start) && t < Number(seg.dataset.end)));
    };
    bar.addEventListener('mousemove', (e) => showPreview(e.clientX));
    bar.addEventListener('mouseleave', () => {
      if (!this.dragging) preview.classList.remove('show');
      this.q('.p-segments').querySelectorAll('.p-seg.hover').forEach((s) => s.classList.remove('hover'));
    });
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragging = true;
      r.classList.add('scrubbing');
      bar.setPointerCapture(e.pointerId);
      const wasPlaying = !v.paused;
      const move = (ev) => {
        const { t } = timeAt(ev.clientX);
        this.q('.p-scrubber').style.left = `${(t / (this.duration() || 1)) * 100}%`;
        showPreview(ev.clientX);
        this.pendingSeek = t;
      };
      move(e);
      const up = (ev) => {
        bar.releasePointerCapture(ev.pointerId);
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        this.dragging = false;
        r.classList.remove('scrubbing');
        preview.classList.remove('show');
        if (this.pendingSeek != null) this.seek(this.pendingSeek);
        this.pendingSeek = null;
        if (wasPlaying) this.play();
        this.#showControls();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });

    document.addEventListener('fullscreenchange', () => {
      const fs = document.fullscreenElement === r;
      r.classList.toggle('fullscreen', fs);
      this.q('.p-fs').innerHTML = icon(fs ? 'fullscreenExit' : 'fullscreen');
    });
  }

  #setIcons() {
    const v = this.video;
    const playIcon = v.ended ? 'replay' : v.paused ? 'play' : 'pause';
    this.root.querySelectorAll('[data-act="play"]').forEach((b) => (b.innerHTML = icon(playIcon)));
    this.q('.p-mute').innerHTML = icon(v.muted || v.volume === 0 ? 'volumeOff' : v.volume < 0.5 ? 'volumeLow' : 'volume');
  }

  // Tastenkürzel (werden global vom Watch-Bereich weitergereicht).
  handleKey(e) {
    const v = this.video;
    const k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (k) {
      case ' ':
      case 'k':
      case 'K':
        this.togglePlay();
        this.#flash(v.paused ? 'pause' : 'play');
        break;
      case 'j':
      case 'J':
        this.seekBy(-10);
        this.#flash('replay', '-10 s');
        break;
      case 'l':
      case 'L':
        this.seekBy(10);
        this.#flash('next', '+10 s');
        break;
      case 'ArrowLeft':
        this.seekBy(-5);
        this.#flash('prev', '-5 s');
        break;
      case 'ArrowRight':
        this.seekBy(5);
        this.#flash('next', '+5 s');
        break;
      case 'ArrowUp':
        v.muted = false;
        v.volume = Math.min(1, v.volume + 0.05);
        this.#flash('volume', `${Math.round(v.volume * 100)} %`);
        break;
      case 'ArrowDown':
        v.volume = Math.max(0, v.volume - 0.05);
        this.#flash('volumeLow', `${Math.round(v.volume * 100)} %`);
        break;
      case 'm':
      case 'M':
        v.muted = !v.muted;
        this.#flash(v.muted ? 'volumeOff' : 'volume');
        break;
      case 'f':
      case 'F':
        this.fullscreen();
        break;
      case 't':
      case 'T':
        emit('player:theater');
        break;
      case 'i':
      case 'I':
        emit('player:mini');
        break;
      case 'c':
      case 'C':
        this.toggleCaptions();
        break;
      case 'N':
        if (e.shiftKey) this.hooks.onNext?.();
        else return false;
        break;
      case 'P':
        if (e.shiftKey) this.hooks.onPrev?.();
        else return false;
        break;
      case '>':
      case '<': {
        const i = SPEEDS.indexOf(v.playbackRate);
        const ni = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + (k === '>' ? 1 : -1)));
        v.playbackRate = SPEEDS[ni];
        this.#flash('speed', `${SPEEDS[ni]}x`);
        break;
      }
      case 'Home':
        this.seek(0);
        break;
      case 'End':
        this.seek(this.duration());
        break;
      case ',':
        if (v.paused) v.currentTime = Math.max(0, v.currentTime - 1 / 30);
        break;
      case '.':
        if (v.paused) v.currentTime += 1 / 30;
        break;
      default:
        if (/^[0-9]$/.test(k)) {
          this.seek((Number(k) / 10) * this.duration());
          break;
        }
        return false;
    }
    this.#showControls();
    return true;
  }
}

// Eine Player-Instanz für die ganze App (bleibt beim Seitenwechsel bestehen → Miniplayer).
export const player = new Player();
