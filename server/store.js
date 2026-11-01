// Persistente Ablage auf dem Handy (JSON-Dateien im data/-Ordner).
// Hier liegen lokale Abos, Verlauf, Playlists, Einstellungen und Login-Daten.
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.VL_DATA_DIR
  ? path.resolve(process.env.VL_DATA_DIR)
  : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const HISTORY_LIMIT = 2000;
const SEARCH_HISTORY_LIMIT = 50;

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  lang: 'de',
  region: 'DE',
  quality: 'auto',
  autoplay: true,
  speed: 1,
  captions: false,
  restricted: false,
  historyPaused: false,
  saveToGallery: false,
  clients: ['ANDROID_VR', 'TV', 'IOS', 'WEB_EMBEDDED', 'MWEB', 'WEB']
};

function emptyLocal() {
  return {
    subscriptions: [],
    history: [],
    searchHistory: [],
    playlists: [],
    watchLater: [],
    liked: [],
    positions: {},
    settings: { ...DEFAULT_SETTINGS }
  };
}

export class JsonFile {
  constructor(name, fallback) {
    this.file = path.join(DATA_DIR, name);
    this.fallback = fallback;
    this.data = this.#read();
    this.timer = null;
  }

  #read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return raw;
    } catch {
      return this.fallback();
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
}

const local = new JsonFile('local.json', emptyLocal);
// Fehlende Felder nach Updates ergänzen.
local.data = { ...emptyLocal(), ...local.data };
local.data.settings = { ...DEFAULT_SETTINGS, ...local.data.settings };

export const auth = new JsonFile('auth.json', () => ({}));

const clean = (v) => ({
  id: String(v.id),
  title: String(v.title || ''),
  thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
  duration: v.duration || '',
  channel: v.channel ? { id: v.channel.id || '', name: v.channel.name || '', avatar: v.channel.avatar || '' } : null,
  short: !!v.short
});

export const store = {
  get settings() {
    return local.data.settings;
  },
  updateSettings(patch) {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    for (const [k, v] of Object.entries(patch || {})) {
      if (allowed.includes(k)) local.data.settings[k] = v;
    }
    local.save();
    return local.data.settings;
  },

  // ---- Abos -------------------------------------------------------------
  get subscriptions() {
    return local.data.subscriptions;
  },
  isSubscribed(channelId) {
    return local.data.subscriptions.some((s) => s.id === channelId);
  },
  subscribe(ch) {
    if (!ch?.id || this.isSubscribed(ch.id)) return;
    local.data.subscriptions.push({ id: ch.id, name: ch.name || '', avatar: ch.avatar || '', since: Date.now() });
    local.data.subscriptions.sort((a, b) => a.name.localeCompare(b.name));
    local.save();
  },
  unsubscribe(channelId) {
    local.data.subscriptions = local.data.subscriptions.filter((s) => s.id !== channelId);
    local.save();
  },

  // ---- Verlauf ----------------------------------------------------------
  get history() {
    return local.data.history;
  },
  addHistory(video) {
    if (local.data.settings.historyPaused || !video?.id) return;
    const h = local.data.history.filter((x) => x.id !== video.id);
    h.unshift({ ...clean(video), watchedAt: Date.now() });
    local.data.history = h.slice(0, HISTORY_LIMIT);
    local.save();
  },
  removeHistory(id) {
    local.data.history = local.data.history.filter((x) => x.id !== id);
    local.save();
  },
  clearHistory() {
    local.data.history = [];
    local.data.positions = {};
    local.save();
  },

  get searchHistory() {
    return local.data.searchHistory;
  },
  addSearch(q) {
    q = String(q || '').trim();
    if (!q || local.data.settings.historyPaused) return;
    const list = local.data.searchHistory.filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    local.data.searchHistory = list.slice(0, SEARCH_HISTORY_LIMIT);
    local.save();
  },
  removeSearch(q) {
    local.data.searchHistory = local.data.searchHistory.filter((x) => x !== q);
    local.save();
  },

  // ---- Wiedergabeposition ----------------------------------------------
  getPosition(id) {
    return local.data.positions[id] || 0;
  },
  setPosition(id, seconds, duration) {
    if (!id) return;
    // Fast zu Ende gesehen -> wieder von vorn beginnen.
    if (!seconds || (duration && seconds > duration - 10)) delete local.data.positions[id];
    else local.data.positions[id] = Math.floor(seconds);
    const keys = Object.keys(local.data.positions);
    if (keys.length > 3000) delete local.data.positions[keys[0]];
    local.save();
  },
  get positions() {
    return local.data.positions;
  },

  // ---- Später ansehen / Mag ich ------------------------------------------
  listOf(name) {
    if (!['watchLater', 'liked'].includes(name)) throw new Error('Unbekannte Liste');
    return local.data[name];
  },
  toggleIn(name, video, on) {
    const list = this.listOf(name).filter((x) => x.id !== video.id);
    if (on) list.unshift(clean(video));
    local.data[name] = list;
    local.save();
    return on;
  },

  // ---- Lokale Playlists -------------------------------------------------
  get playlists() {
    return local.data.playlists;
  },
  getPlaylist(id) {
    return local.data.playlists.find((p) => p.id === id);
  },
  createPlaylist(title, privacy = 'PRIVATE') {
    const p = { id: 'LP' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: String(title || 'Playlist').slice(0, 150), privacy, videos: [], updated: Date.now() };
    local.data.playlists.unshift(p);
    local.save();
    return p;
  },
  deletePlaylist(id) {
    local.data.playlists = local.data.playlists.filter((p) => p.id !== id);
    local.save();
  },
  renamePlaylist(id, title) {
    const p = this.getPlaylist(id);
    if (p) {
      p.title = String(title).slice(0, 150);
      p.updated = Date.now();
      local.save();
    }
    return p;
  },
  setInPlaylist(id, video, on) {
    const p = this.getPlaylist(id);
    if (!p) throw new Error('Playlist nicht gefunden');
    p.videos = p.videos.filter((v) => v.id !== video.id);
    if (on) p.videos.push(clean(video));
    p.updated = Date.now();
    local.save();
    return p;
  },

  // Für Export/Import (Backup).
  exportAll() {
    return JSON.parse(JSON.stringify(local.data));
  },
  importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Ungültige Datei');
    local.data = { ...emptyLocal(), ...data, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
    local.save();
  },
  flush() {
    local.flush();
    auth.flush();
  }
};
