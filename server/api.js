// Alle /api-Endpunkte. Antworten sind schlanke JSON-Objekte für das Frontend.
import { YTNodes } from 'youtubei.js';
import { formatNumberDe } from './polyfills.js';
import { getYT, resetYT, authState, isSignedIn, startOAuth, cancelOAuth, cookieLogin, signOut } from './yt.js';
import { store } from './store.js';
import {
  collectItems, itemsFromFeed, itemsFromTvRaw, normalizeComment, textToHtml, thumb, txt, escapeHtml, videoThumb, formatDuration, unwrap
} from './normalize.js';
import { streamsFor, dashManifest, invalidate, resolveVideo, downloadOptions, openDownload, isAllowedUpstream } from './stream.js';
import * as offline from './offline.js';
import { localSubscriptionFeed } from './rss.js';
import { EndlessFeed, shuffle } from './endless.js';
import { forYou, interleave, cleanup } from './recommend.js';
import { ShortsFeed } from './shorts.js';

// ---- Fortsetzungen (Endlos-Scrollen) ----------------------------------------
const conts = new Map();
const CONT_TTL = 30 * 60 * 1000;

function saveCont(obj, kind) {
  if (!obj) return null;
  const key = kind + '_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  conts.set(key, { obj, at: Date.now(), kind });
  if (conts.size > 3000) conts.delete(conts.keys().next().value);
  return key;
}

function loadCont(key, kind) {
  const c = conts.get(key);
  if (!c || c.kind !== kind || Date.now() - c.at > CONT_TTL) {
    throw httpError(410, 'Die Liste ist abgelaufen. Bitte Seite neu laden.');
  }
  return c.obj;
}

function loadEntry(key) {
  const c = conts.get(key);
  if (!c || Date.now() - c.at > CONT_TTL) throw httpError(410, 'Die Liste ist abgelaufen. Bitte Seite neu laden.');
  c.at = Date.now();
  return c;
}

// Endlos weiter: Ist eine YouTube-Liste zu Ende, übernimmt der Endlos-Feed.
function endlessCont(items, extraSeeds = []) {
  const ids = items.filter((i) => i.type === 'video').map((i) => i.id);
  const seeds = shuffle([...ids, ...extraSeeds]).slice(0, 40);
  if (!seeds.length) seeds.push(...store.history.slice(0, 10).map((v) => v.id));
  return saveCont(new EndlessFeed(getYT, seeds, ids), 'endless');
}

// Lädt die nächste Seite einer beliebigen Startseiten-/Ähnliche-Videos-Liste.
async function nextPage(key) {
  const entry = loadEntry(key);
  const obj = entry.obj;
  let items;
  let next = null;
  switch (entry.kind) {
    case 'endless':
      items = await obj.next();
      return { items, cont: key };
    case 'search':
      next = await obj.getContinuation();
      items = collectItems(next.results);
      return { items, cont: hasCont(next) ? saveCont(next, 'search') : endlessCont(items) };
    case 'related':
      next = await obj.getWatchNextContinuation();
      items = collectItems(next.watch_next_feed);
      return { items, cont: next.wn_has_continuation ? saveCont(next, 'related') : endlessCont(items) };
    case 'home':
      next = await obj.getContinuation();
      items = itemsFromFeed(next);
      return { items, cont: hasCont(next) ? saveCont(next, 'home') : endlessCont(items, store.history.slice(0, 10).map((v) => v.id)) };
    default:
      throw httpError(400, 'Unbekannte Liste');
  }
}

// Mit Geräte-Code-Anmeldung (TV) lehnt die Web-Schnittstelle manche privaten Listen ab
// ("Die Playlist ist nicht vorhanden"). Dann über die TV-Schnittstelle laden.
async function tvBrowse(browseId) {
  const yt = await getYT();
  const res = await yt.actions.execute('/browse', { browseId, client: 'TV', parse: false });
  return itemsFromTvRaw(res?.data ?? res);
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const hasCont = (feed) => {
  try {
    return !!feed?.has_continuation;
  } catch {
    return false;
  }
};

function feedResult(feed, kind, extra = {}) {
  const items = itemsFromFeed(feed);
  return { items, cont: hasCont(feed) ? saveCont(feed, kind) : null, ...extra };
}

function requireLogin() {
  if (!isSignedIn()) throw httpError(401, 'Dafür musst du angemeldet sein.');
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
function checkId(id) {
  if (!VIDEO_ID.test(id || '')) throw httpError(400, 'Ungültige Video-ID');
  return id;
}

const FILTER_NAMES = (feed) => {
  try {
    return feed.filters || [];
  } catch {
    return [];
  }
};

// ---- Handler ------------------------------------------------------------------
export const routes = {
  'GET /api/status': async () => ({ auth: publicAuth(), settings: store.settings }),

  'GET /api/home': async (q) => {
    if (q.get('cont')) return nextPage(q.get('cont'));
    return cachedHome(q.get('chip') || '', q.get('fresh') === '1');
  },

  'GET /api/search': async (q) => {
    if (q.get('cont')) {
      const s = loadCont(q.get('cont'), 'search');
      const next = await s.getContinuation();
      return { items: collectItems(next.results), cont: hasCont(next) ? saveCont(next, 'search') : null };
    }
    const query = (q.get('q') || '').trim();
    if (!query) return { items: [], cont: null };
    store.addSearch(query);
    const filters = {};
    const map = { type: ['all', 'video', 'shorts', 'channel', 'playlist', 'movie'], upload_date: ['all', 'today', 'week', 'month', 'year'], duration: ['all', 'short', 'medium', 'long'], prioritize: ['relevance', 'popularity'] };
    for (const [k, allowed] of Object.entries(map)) {
      const v = q.get(k);
      if (v && allowed.includes(v) && v !== 'all' && v !== 'relevance') filters[k] = v;
    }
    const features = (q.get('features') || '').split(',').filter((f) => ['hd', 'subtitles', 'creative_commons', '3d', 'live', '4k', '360', 'location', 'hdr', 'vr180'].includes(f));
    if (features.length) filters.features = features;
    const yt = await getYT();
    const s = await yt.search(query, filters);
    let corrected = null;
    try {
      const dym = s.results?.find?.((n) => n.type === 'DidYouMean' || n.type === 'ShowingResultsFor');
      if (dym) corrected = txt(dym.corrected_query || dym.did_you_mean);
    } catch {}
    return { items: collectItems(s.results), cont: hasCont(s) ? saveCont(s, 'search') : null, corrected, estimated: s.estimated_results || 0 };
  },

  'GET /api/suggest': async (q) => {
    const query = (q.get('q') || '').trim();
    if (!query) return { suggestions: store.searchHistory.slice(0, 12).map((s) => ({ text: s, history: true })) };
    const hist = store.searchHistory.filter((s) => s.toLowerCase().startsWith(query.toLowerCase())).slice(0, 3);
    let list = [];
    try {
      const yt = await getYT();
      list = (await yt.getSearchSuggestions(query)).filter((s) => typeof s === 'string' && s.trim());
    } catch {}
    const seen = new Set(hist.map((h) => h.toLowerCase()));
    return {
      suggestions: [
        ...hist.map((text) => ({ text, history: true })),
        ...list.filter((s) => !seen.has(s.toLowerCase())).slice(0, 12 - hist.length).map((text) => ({ text, history: false }))
      ]
    };
  },

  'DELETE /api/suggest': async (q) => {
    store.removeSearch(q.get('q') || '');
    return { ok: true };
  },

  'GET /api/video/:id': async (q, { id }) => {
    checkId(id);
    let data;
    try {
      data = await cachedVideo(id, q.get('list'), q.get('index'));
    } catch (e) {
      // Ohne Internet: heruntergeladenes Video trotzdem anzeigen.
      const off = offline.getItem(id);
      if (!off) throw e;
      return offlineVideoData(off);
    }
    // Position und Abo-Status können sich seit dem Zwischenspeichern geändert haben.
    return { ...data, position: store.getPosition(id), subscribed: isSignedIn() ? data.subscribed : store.isSubscribed(data.channel.id) };
  },

  'GET /api/related': async (q) => nextPage(q.get('cont')),

  'GET /api/streams/:id': async (q, { id }) => {
    checkId(id);
    // Heruntergeladen? Dann immer die Datei aus dem App-Speicher (geht auch offline).
    const off = offline.getItem(id);
    if (off) return offlineStreams(off);
    if (q.get('fresh')) invalidate(id);
    return streamsFor(id);
  },

  // ---- Offline-Downloads (App-Speicher) -------------------------------------
  'GET /api/offline': async () => ({ items: offline.items().map(offline.publicItem), jobs: offline.jobList() }),
  'GET /api/online': async () => ({ online: await offline.isOnline() }),
  'POST /api/offline/:id': async (q, { id }, body) => {
    checkId(id);
    const url = String(body.url || '');
    const meta = {
      title: String(body.title || ''),
      short: !!body.short,
      label: String(body.label || ''),
      duration: Number(body.duration) || 0,
      channel: body.channel && typeof body.channel === 'object' ? { id: String(body.channel.id || ''), name: String(body.channel.name || ''), avatar: String(body.channel.avatar || '') } : null
    };
    let open;
    const dl = url.match(/^\/dl\/([\w-]{11})\?(.*)$/);
    if (dl) {
      const p = new URLSearchParams(dl[2]);
      open = (signal) => openDownload(id, { v: p.get('v'), a: p.get('a'), signal });
    } else {
      // Einfacher Download (z. B. 360p mit Ton): Quelle steckt im Proxy-Link /vp?u=…
      const vp = url.match(/^\/vp\?(.*)$/);
      const target = vp ? new URLSearchParams(vp[1]).get('u') : null;
      if (!target || !isAllowedUpstream(target)) throw httpError(400, 'Ungültige Download-Quelle');
      open = async (signal) => {
        const { fetchChunks } = await import('./mux.js');
        const r = await resolveVideo(id).catch(() => null);
        return { source: fetchChunks(target, { signal }), size: 0, audioOnly: !!body.audioOnly, height: 0, info: r?.info };
      };
    }
    offline.start(id, meta, open);
    return { ok: true, jobs: offline.jobList() };
  },
  'DELETE /api/offline/:id': async (q, { id }) => {
    offline.remove(checkId(id));
    return { ok: true };
  },

  'GET /api/download/:id': async (q, { id }) => downloadOptions(checkId(id)),

  'GET /api/manifest/:file': async (q, { file }) => {
    const id = checkId(String(file).replace(/\.mpd$/, ''));
    return { __raw: await dashManifest(id), __type: 'application/dash+xml' };
  },

  'GET /api/comments/:id': async (q, { id }) => {
    if (q.get('cont')) {
      const c = loadCont(q.get('cont'), 'comments');
      const next = await c.getContinuation();
      return commentsResult(next);
    }
    const yt = await getYT();
    const sort = q.get('sort') === 'new' ? 'NEWEST_FIRST' : 'TOP_COMMENTS';
    const c = await yt.getComments(checkId(id), sort);
    return { ...commentsResult(c), count: txt(c.header?.count) || txt(c.header?.comments_count) };
  },

  'GET /api/replies': async (q) => {
    const more = q.get('more') === '1';
    const obj = loadCont(q.get('cont'), more ? 'replies' : 'thread');
    const res = more ? await obj.getContinuation() : await obj.getReplies();
    const items = (res.replies || []).map((r) => {
      const n = normalizeComment(r);
      if (n && isSignedIn() && r.comment) n.key = saveCont(r.comment, 'cview');
      return n;
    }).filter(Boolean);
    let hasMore = false;
    try {
      hasMore = !!res.has_continuation;
    } catch {}
    return { items, cont: hasMore ? saveCont(res, 'replies') : null };
  },

  'GET /api/channel/:id': async (q, { id }) => {
    const yt = await getYT();
    let channelId = id;
    if (id.startsWith('@')) channelId = await resolveHandle(id);
    const tab = q.get('tab') || 'home';
    if (q.get('cont')) {
      const feed = loadCont(q.get('cont'), 'channel');
      const next = await feed.getContinuation();
      return feedResult(next, 'channel');
    }
    const channel = await yt.getChannel(channelId);
    const head = channelHeader(channel, channelId);
    let feed = channel;
    const getters = { videos: 'getVideos', shorts: 'getShorts', streams: 'getLiveStreams', playlists: 'getPlaylists', posts: 'getCommunity', podcasts: 'getPodcasts', releases: 'getReleases' };
    if (tab === 'about') {
      return { channel: head, about: await channelAbout(channel, head), items: [], cont: null };
    }
    if (getters[tab]) {
      try {
        feed = await channel[getters[tab]]();
      } catch (e) {
        return { channel: head, items: [], cont: null, filters: [], error: 'Dieser Tab ist für den Kanal nicht verfügbar.' };
      }
    }
    const sort = q.get('sort');
    const filters = FILTER_NAMES(feed);
    if (sort && filters.includes(sort)) {
      try {
        feed = await feed.applyFilter(sort);
      } catch {}
    }
    return { channel: head, filters, ...feedResult(feed, 'channel') };
  },

  'GET /api/channel/:id/search': async (q, { id }) => {
    const yt = await getYT();
    const channel = await yt.getChannel(id.startsWith('@') ? await resolveHandle(id) : id);
    const res = await channel.search(q.get('q') || '');
    return { ...feedResult(res, 'channel') };
  },

  'GET /api/resolve': async (q) => {
    const yt = await getYT();
    const url = q.get('url') || '';
    const ep = await yt.resolveURL(url.startsWith('http') ? url : 'https://www.youtube.com' + (url.startsWith('/') ? '' : '/') + url);
    const p = ep?.payload || {};
    if (p.videoId) return { type: 'video', id: p.videoId };
    if (p.browseId?.startsWith('UC')) return { type: 'channel', id: p.browseId };
    if (p.browseId?.startsWith('VL')) return { type: 'playlist', id: p.browseId.slice(2) };
    if (p.playlistId) return { type: 'playlist', id: p.playlistId };
    return { type: 'unknown' };
  },

  'GET /api/playlist/:id': async (q, { id }) => {
    if (id.startsWith('LP')) {
      const p = store.getPlaylist(id);
      if (!p) throw httpError(404, 'Playlist nicht gefunden');
      return {
        info: { id, title: p.title, local: true, count: `${p.videos.length} Videos`, privacy: p.privacy, updated: p.updated, thumbnail: p.videos[0]?.thumbnail || '', author: { name: 'Du' }, editable: true },
        items: p.videos.map((v) => ({ type: 'video', ...v })),
        cont: null
      };
    }
    if ((id === 'WL' || id === 'LL') && !isSignedIn()) {
      const name = id === 'WL' ? 'watchLater' : 'liked';
      const list = store.listOf(name);
      return {
        info: { id, title: id === 'WL' ? 'Später ansehen' : 'Videos mit „Mag ich“-Bewertung', local: true, count: `${list.length} Videos`, thumbnail: list[0]?.thumbnail || '', author: { name: 'Du' }, editable: true },
        items: list.map((v) => ({ type: 'video', ...v })),
        cont: null
      };
    }
    if (q.get('cont')) {
      const p = loadCont(q.get('cont'), 'playlist');
      const next = await p.getContinuation();
      return { items: collectItems(next.items), cont: hasCont(next) ? saveCont(next, 'playlist') : null };
    }
    const yt = await getYT();
    let p;
    try {
      p = await yt.getPlaylist(id);
    } catch (e) {
      if (!['WL', 'LL'].includes(id) && !id.startsWith('PL')) throw e;
      return playlistFallback(id, e);
    }
    const i = p.info || {};
    const items = collectItems(p.items);
    return {
      info: {
        id,
        title: i.title || '',
        description: i.description || '',
        count: i.total_items || '',
        views: i.views || '',
        updated: i.last_updated || '',
        privacy: i.privacy || '',
        thumbnail: thumb(i.thumbnails, 720) || items[0]?.thumbnail || '',
        author: i.author ? { id: i.author.id, name: i.author.name, avatar: thumb(i.author.thumbnails, 88) } : null,
        editable: !!i.is_editable
      },
      items,
      cont: hasCont(p) ? saveCont(p, 'playlist') : null
    };
  },

  'GET /api/shorts': async (q) => {
    try {
      const r = await shortsFeed(q);
      // Kaum etwas bekommen (offline)? Heruntergeladene Shorts anhängen.
      if (r.ids.length <= 1 && !q.get('cont')) {
        const own = offline.items().filter((i) => i.short).map((i) => i.id);
        if (own.length) return { ...r, ids: [...r.ids, ...own.filter((i) => !r.ids.includes(i))] };
      }
      return r;
    } catch (e) {
      // Ohne Internet: heruntergeladene Shorts zeigen.
      const own = offline.items().filter((i) => i.short).map((i) => i.id);
      if (!own.length || q.get('cont')) throw e;
      const hint = q.get('seed');
      return { ids: hint && own.includes(hint) ? [hint, ...own.filter((i) => i !== hint)] : own, cont: null, offline: true };
    }
  },
  'GET /api/short/:id': async (q, { id }) => {
    checkId(id);
    try {
      return await shortMeta(id);
    } catch (e) {
      const off = offline.getItem(id);
      if (!off) throw e;
      const p = offline.publicItem(off);
      return { id, title: p.title, channel: p.channel, likes: null, liked: false, disliked: false, views: null, comments: '', subscribed: store.isSubscribed(p.channel.id), thumbnail: p.thumbnail, offline: true };
    }
  },


  'GET /api/hashtag/:tag': async (q, { tag }) => {
    if (q.get('cont')) {
      const f = loadCont(q.get('cont'), 'hashtag');
      return feedResult(await f.getContinuation(), 'hashtag');
    }
    const yt = await getYT();
    const feed = await yt.getHashtag(tag);
    let title = '#' + tag;
    let subtitle = '';
    try {
      title = txt(feed.header?.hashtag || feed.header?.title) || title;
      subtitle = [txt(feed.header?.hashtag_info_text), txt(feed.header?.channel_info_text)].filter(Boolean).join(' • ');
    } catch {}
    return { title, subtitle, ...feedResult(feed, 'hashtag') };
  },

  // ---- Abos & Feeds -------------------------------------------------------------
  'GET /api/feed/subscriptions': async (q) => {
    if (isSignedIn() && q.get('local') !== '1') {
      if (q.get('cont')) return feedResult(await loadCont(q.get('cont'), 'subs').getContinuation(), 'subs');
      const yt = await getYT();
      try {
        const res = feedResult(await yt.getSubscriptionsFeed(), 'subs');
        if (res.items.length) return res;
      } catch (e) {
        console.warn('[abos] Web-Abruf fehlgeschlagen:', e.message);
      }
      const items = await tvBrowse('FEsubscriptions').catch(() => []);
      if (items.length) return { items, cont: null };
    }
    const { items, errors } = await localSubscriptionFeed(store.subscriptions, { shorts: q.get('shorts') === '1' });
    return { items, cont: null, local: true, errors };
  },

  'GET /api/subscriptions': async () => {
    if (isSignedIn()) {
      try {
        const yt = await getYT();
        const feed = await yt.getChannelsFeed();
        let items = itemsFromFeed(feed).filter((i) => i.type === 'channel');
        let f = feed;
        for (let i = 0; i < 20 && hasCont(f); i++) {
          f = await f.getContinuation();
          items = items.concat(itemsFromFeed(f).filter((x) => x.type === 'channel'));
        }
        return { items, account: true };
      } catch (e) {
        return { items: store.subscriptions.map(localChannel), account: false, error: e.message };
      }
    }
    return { items: store.subscriptions.map(localChannel), account: false };
  },

  'POST /api/subscribe': async (q, p, body) => {
    const ch = body.channel || {};
    if (!/^UC[\w-]{22}$/.test(ch.id || '')) throw httpError(400, 'Ungültige Kanal-ID');
    if (isSignedIn()) {
      const yt = await getYT();
      if (body.on) await yt.interact.subscribe(ch.id);
      else await yt.interact.unsubscribe(ch.id);
    }
    if (body.on) store.subscribe(ch);
    else store.unsubscribe(ch.id);
    return { subscribed: !!body.on };
  },

  'POST /api/notifications/pref': async (q, p, body) => {
    requireLogin();
    const yt = await getYT();
    const type = ['ALL', 'PERSONALIZED', 'NONE'].includes(body.type) ? body.type : 'PERSONALIZED';
    await yt.interact.setNotificationPreferences(body.channelId, type);
    return { ok: true };
  },

  'GET /api/notifications': async (q) => {
    requireLogin();
    const yt = await getYT();
    const menu = q.get('cont') ? await loadCont(q.get('cont'), 'notif').getContinuation() : await yt.getNotifications();
    const items = (menu.contents || []).filter((n) => n.type === 'Notification').map((n) => ({
      id: n.notification_id,
      avatar: thumb(n.thumbnails, 88),
      thumbnail: thumb(n.video_thumbnails, 320),
      text: txt(n.short_message),
      time: txt(n.sent_time),
      read: !!n.read,
      url: n.endpoint?.payload?.videoId ? `/watch?v=${n.endpoint.payload.videoId}` : (n.endpoint?.metadata?.url || '')
    }));
    let cont = null;
    try {
      cont = saveCont(menu, 'notif');
    } catch {}
    return { items, cont: items.length ? cont : null };
  },

  'GET /api/notifications/count': async () => {
    if (!isSignedIn()) return { count: 0 };
    try {
      const yt = await getYT();
      return { count: await yt.getUnseenNotificationsCount() };
    } catch {
      return { count: 0 };
    }
  },

  // ---- Bewertungen, Kommentare -------------------------------------------------
  'POST /api/rate': async (q, p, body) => {
    const id = checkId(body.id);
    const rating = body.rating;
    if (isSignedIn()) {
      const yt = await getYT();
      if (rating === 'like') await yt.interact.like(id);
      else if (rating === 'dislike') await yt.interact.dislike(id);
      else await yt.interact.removeRating(id);
    }
    if (body.video) store.toggleIn('liked', { ...body.video, id }, rating === 'like');
    return { rating };
  },

  'POST /api/comment': async (q, p, body) => {
    requireLogin();
    const yt = await getYT();
    const text = String(body.text || '').trim();
    if (!text) throw httpError(400, 'Kommentar ist leer');
    await yt.interact.comment(checkId(body.id), text);
    return { ok: true };
  },

  'POST /api/comment/action': async (q, p, body) => {
    requireLogin();
    const c = loadCont(body.key, 'cview');
    const action = body.action;
    if (!['like', 'unlike', 'dislike', 'undislike', 'reply'].includes(action)) throw httpError(400, 'Unbekannte Aktion');
    if (action === 'reply') {
      const text = String(body.text || '').trim();
      if (!text) throw httpError(400, 'Antwort ist leer');
      await c.reply(text);
    } else {
      await c[action]();
    }
    return { ok: true };
  },

  // ---- Verlauf ----------------------------------------------------------------
  'GET /api/feed/history': async (q) => {
    if (isSignedIn() && q.get('local') !== '1') {
      const yt = await getYT();
      if (q.get('cont')) return historyResult(await loadCont(q.get('cont'), 'history').getContinuation());
      try {
        const h = q.get('q') ? await (await yt.getHistory()).search(q.get('q')) : await yt.getHistory();
        const res = historyResult(h);
        if (res.items.length || res.sections.length) return res;
      } catch (e) {
        console.warn('[verlauf] Web-Abruf fehlgeschlagen:', e.message);
      }
      if (!q.get('q')) {
        const items = await tvBrowse('FEhistory').catch(() => []);
        if (items.length) return { sections: [], items, cont: null };
      }
    }
    const query = (q.get('q') || '').toLowerCase();
    const list = store.history.filter((v) => !query || v.title.toLowerCase().includes(query) || v.channel?.name?.toLowerCase().includes(query));
    return { items: list.slice(0, 500).map((v) => ({ type: v.short ? 'short' : 'video', ...v })), cont: null, local: true, paused: store.settings.historyPaused };
  },

  'POST /api/history': async (q, p, body) => {
    const v = body.video || {};
    checkId(v.id);
    store.addHistory(v);
    if (isSignedIn() && !store.settings.historyPaused) {
      try {
        const yt = await getYT();
        const info = await yt.getBasicInfo(v.id);
        await info.addToWatchHistory();
      } catch {
        /* nicht kritisch */
      }
    }
    return { ok: true };
  },

  'DELETE /api/history': async (q) => {
    const id = q.get('id');
    if (id) {
      store.removeHistory(id);
      if (isSignedIn()) {
        try {
          const yt = await getYT();
          await (await yt.getHistory()).removeVideo(id, 3);
        } catch {}
      }
    } else {
      store.clearHistory();
      if (isSignedIn()) {
        try {
          const yt = await getYT();
          await (await yt.getHistory()).clearWatchHistory();
        } catch {}
      }
    }
    return { ok: true };
  },

  'POST /api/history/pause': async (q, p, body) => {
    store.updateSettings({ historyPaused: !!body.paused });
    if (isSignedIn()) {
      try {
        const yt = await getYT();
        const h = await yt.getHistory();
        if (body.paused) await h.pauseWatchHistory();
        else await h.resumeWatchHistory();
      } catch {}
    }
    return { paused: store.settings.historyPaused };
  },

  'GET /api/position/:id': async (q, { id }) => ({ t: store.getPosition(id) }),
  'POST /api/position': async (q, p, body) => {
    store.setPosition(checkId(body.id), Number(body.t) || 0, Number(body.d) || 0);
    return { ok: true };
  },
  'GET /api/positions': async () => ({ positions: store.positions }),

  // ---- Bibliothek / Playlists -------------------------------------------------
  'GET /api/library': async () => {
    const res = {
      history: store.history.slice(0, 20).map((v) => ({ type: v.short ? 'short' : 'video', ...v })),
      local: store.playlists.map(localPlaylistItem),
      watchLater: { count: store.listOf('watchLater').length, thumbnail: store.listOf('watchLater')[0]?.thumbnail || '' },
      liked: { count: store.listOf('liked').length, thumbnail: store.listOf('liked')[0]?.thumbnail || '' },
      playlists: [],
      account: isSignedIn()
    };
    if (isSignedIn()) {
      const yt = await getYT();
      try {
        const h = await yt.getHistory();
        const items = itemsFromFeed(h);
        if (items.length) res.history = items.slice(0, 20);
      } catch {}
      try {
        res.playlists = itemsFromFeed(await yt.getPlaylists()).filter((i) => i.type === 'playlist');
      } catch {}
    }
    return res;
  },

  'GET /api/save-options/:id': async (q, { id }) => {
    checkId(id);
    const options = [];
    if (isSignedIn()) {
      try {
        const yt = await getYT();
        const r = await yt.actions.execute('/playlist/get_add_to_playlist', { videoIds: [id], excludeWatchLater: false, parse: true });
        const nodes = [];
        walkType(r, 'PlaylistAddToOption', nodes);
        for (const n of nodes) options.push({ id: n.playlist_id, title: txt(n.title), on: n.contains_selected_videos === 'ALL', privacy: n.privacy || '', account: true });
      } catch (e) {
        options.push({ id: 'WL', title: 'Später ansehen', on: false, account: true });
      }
    } else {
      options.push({ id: 'WL', title: 'Später ansehen', on: store.listOf('watchLater').some((v) => v.id === id), account: false });
    }
    for (const p of store.playlists) options.push({ id: p.id, title: p.title, on: p.videos.some((v) => v.id === id), privacy: p.privacy, account: false, local: true });
    return { options };
  },

  'POST /api/save': async (q, p, body) => {
    const video = body.video || {};
    checkId(video.id);
    const pid = String(body.playlistId || '');
    const on = !!body.on;
    if (pid.startsWith('LP')) {
      store.setInPlaylist(pid, video, on);
    } else if (pid === 'WL' && !isSignedIn()) {
      store.toggleIn('watchLater', video, on);
    } else {
      requireLogin();
      const yt = await getYT();
      if (on) await yt.playlist.addVideos(pid, [video.id]);
      else await yt.playlist.removeVideos(pid, [video.id]);
    }
    return { on };
  },

  'POST /api/playlists': async (q, p, body) => {
    const title = String(body.title || '').trim();
    if (!title) throw httpError(400, 'Titel fehlt');
    const privacy = ['PUBLIC', 'PRIVATE', 'UNLISTED'].includes(body.privacy) ? body.privacy : 'PRIVATE';
    const ids = (body.videoIds || []).filter((v) => /^[\w-]{11}$/.test(v));
    if (isSignedIn() && !body.local) {
      const yt = await getYT();
      const r = await yt.playlist.create(title, ids, privacy);
      return { id: r.playlist_id, title, account: true };
    }
    const pl = store.createPlaylist(title, privacy);
    if (body.video) store.setInPlaylist(pl.id, body.video, true);
    return { id: pl.id, title, local: true };
  },

  'PATCH /api/playlists/:id': async (q, { id }, body) => {
    if (id.startsWith('LP')) return store.renamePlaylist(id, body.title);
    requireLogin();
    const yt = await getYT();
    if (body.title) await yt.playlist.setName(id, body.title);
    if (body.description != null) await yt.playlist.setDescription(id, body.description);
    return { ok: true };
  },

  'DELETE /api/playlists/:id': async (q, { id }) => {
    if (id.startsWith('LP')) {
      store.deletePlaylist(id);
      return { ok: true };
    }
    requireLogin();
    const yt = await getYT();
    await yt.playlist.delete(id);
    return { ok: true };
  },

  'POST /api/list/:name': async (q, { name }, body) => {
    if (!['watchLater', 'liked'].includes(name)) throw httpError(404, 'Unbekannte Liste');
    const video = body.video || {};
    checkId(video.id);
    return { on: store.toggleIn(name, video, !!body.on) };
  },

  // ---- Einstellungen, Backup --------------------------------------------------
  'POST /api/settings': async (q, p, body) => {
    const before = { ...store.settings };
    const s = store.updateSettings(body);
    if (before.lang !== s.lang || before.region !== s.region || before.restricted !== s.restricted) await resetYT();
    if (JSON.stringify(before.clients) !== JSON.stringify(s.clients)) invalidate();
    return s;
  },

  'GET /api/backup': async () => ({ __raw: JSON.stringify(store.exportAll(), null, 1), __type: 'application/json', __download: 'video-launcher-backup.json' }),
  'POST /api/backup': async (q, p, body) => {
    store.importAll(body);
    return { ok: true };
  },

  // ---- Anmeldung --------------------------------------------------------------
  'GET /api/auth/status': async () => publicAuth(),
  'POST /api/auth/oauth': async () => {
    const r = await startOAuth();
    return { ...publicAuth(), ...r };
  },
  'POST /api/auth/cancel': async () => {
    cancelOAuth();
    return publicAuth();
  },
  'POST /api/auth/cookie': async (q, p, body) => {
    await cookieLogin(body.cookie);
    return publicAuth();
  },
  'POST /api/auth/logout': async () => {
    await signOut();
    return publicAuth();
  }
};

// Video-Seite ohne Internet: Angaben aus dem Download.
function offlineVideoData(off) {
  const p = offline.publicItem(off);
  return {
    id: p.id,
    title: p.title,
    channel: { ...p.channel, subscribers: '', verified: false },
    views: 'Heruntergeladen',
    shortViews: '',
    published: '',
    relativeDate: '',
    durationText: p.durationText,
    descriptionHtml: (off.description || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/\n/g, '<br>'),
    keywords: [],
    chapters: [],
    metadataRows: [],
    superTitle: '',
    likes: null,
    liked: false,
    disliked: false,
    subscribed: store.isSubscribed(p.channel.id),
    position: store.getPosition(p.id),
    related: offline.items().filter((i) => i.id !== p.id && !i.short).map(offline.publicItem),
    relatedCont: null,
    offline: true
  };
}

function offlineStreams(off) {
  const p = offline.publicItem(off);
  const url = `/offline/${off.id}.${off.audioOnly ? 'm4a' : 'mp4'}`;
  return {
    id: off.id,
    client: 'offline',
    source: 'offline',
    offline: true,
    live: false,
    duration: off.duration || 0,
    title: p.title,
    thumbnail: p.thumbnail,
    dash: null,
    hls: null,
    progressive: [{ itag: 0, label: off.label || 'Download', mime: off.audioOnly ? 'audio/mp4' : 'video/mp4', url }],
    audio: [],
    captions: [],
    storyboard: null
  };
}

async function shortsFeed(q) {
  const hint = q.get('seed');
  let key = q.get('cont');
  let feed;
  if (key) {
    feed = loadCont(key, 'shorts');
  } else {
    feed = new ShortsFeed(getYT, {
      history: store.history,
      liked: store.listOf('liked'),
      signedIn: isSignedIn(),
      subsShorts: async () => (await localSubscriptionFeed(store.subscriptions, { shorts: true })).items.map((v) => v.id)
    });
    key = saveCont(feed, 'shorts');
  }
  let ids = await feed.next(hint);
  // Direkt geöffneter Short (/shorts/ID) kommt zuerst.
  if (!q.get('cont') && hint) ids = [hint, ...ids.filter((i) => i !== hint)];
  prefetchShorts(ids.slice(0, 3));
  return { ids, cont: key };
}

async function playlistFallback(id, err) {
  const titles = { WL: 'Später ansehen', LL: 'Videos mit „Mag ich“-Bewertung' };
  let items = [];
  try {
    if (isSignedIn()) items = await tvBrowse('VL' + id);
  } catch (e) {
    console.warn('[playlist] TV-Abruf fehlgeschlagen:', e.message);
  }
  const local = id === 'WL' ? store.listOf('watchLater') : id === 'LL' ? store.listOf('liked') : [];
  if (!items.length && !local.length && !titles[id]) throw err;
  const all = [...items, ...local.filter((v) => !items.some((i) => i.id === v.id)).map((v) => ({ type: 'video', ...v }))];
  return {
    info: { id, title: titles[id] || 'Playlist', count: `${all.length} Videos`, thumbnail: all[0]?.thumbnail || '', author: { name: 'Du' }, editable: !items.length, local: !items.length },
    items: all,
    cont: null
  };
}

// ---- Startseite (zwischengespeichert, parallel berechnet) -----------------------------
const HOME_TTL = 3 * 60 * 1000;
const homeCache = new Map(); // chip -> { at, promise }

function cachedHome(chip, fresh) {
  const key = `${isSignedIn() ? 'a' : 'l'}:${chip}`;
  const hit = homeCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < HOME_TTL) return hit.promise;
  const promise = computeHome(chip).catch((e) => {
    homeCache.delete(key);
    throw e;
  });
  homeCache.set(key, { at: Date.now(), promise });
  return promise;
}

// Beim Start schon vorbereiten, damit die App sofort Inhalte zeigt.
export function warmHome() {
  cachedHome('', false).catch(() => {});
}

async function computeHome(chip) {
  const yt = await getYT();
  const historySeeds = store.history.slice(0, 10).map((v) => v.id);
  const personal = !isSignedIn() && !chip;
  // Eigene Empfehlungen und YouTubes Startseite gleichzeitig laden.
  const mixPromise = personal
    ? forYou(yt, { history: store.history, subsFeed: async () => (await localSubscriptionFeed(store.subscriptions)).items })
    : null;
  let feed = null;
  try {
    feed = await yt.getHomeFeed();
  } catch {}
  let chips = feed ? FILTER_NAMES(feed) : [];
  if (feed && chip && chip !== chips[0]) feed = await feed.getFilteredFeed(chip);
  let items = feed ? itemsFromFeed(feed) : [];
  let cont = items.length && hasCont(feed) ? saveCont(feed, 'home') : null;
  // Angemeldet, aber die Web-Startseite ist leer (TV-Anmeldung) → TV-Startseite.
  if (isSignedIn() && !items.length) {
    for (const id of ['FEwhat_to_watch', 'default']) {
      items = await tvBrowse(id).catch(() => []);
      if (items.length) break;
    }
    if (items.length) cont = endlessCont(items, historySeeds);
  }
  // Ohne Konto: "Für dich" aus Verlauf und Abos, YouTubes Startseite als Ergänzung.
  if (mixPromise) {
    const mix = await mixPromise.catch(() => ({ items: [], seeds: [] }));
    const shelves = items.filter((i) => i.type === 'shelf');
    const watched = new Set(store.history.map((v) => v.id));
    const merged = cleanup(interleave([mix.items, mix.items.slice(1), items.filter((i) => i.type === 'video')]), watched);
    if (merged.length) {
      // Shorts-Regal von YouTube an siebter Stelle (wie in der App).
      items = [...merged.slice(0, 6), ...shelves.slice(0, 1), ...merged.slice(6)];
      const endless = new EndlessFeed(getYT, shuffle([...mix.seeds, ...historySeeds]), merged.map((v) => v.id).concat([...watched]));
      cont = saveCont(endless, 'endless');
    }
  }
  if (!items.length) {
    chips = [];
    const search = await yt.search(store.settings.region === 'DE' ? 'Trends Deutschland' : 'trending', { type: 'video', upload_date: 'week' });
    items = collectItems(search.results);
    cont = hasCont(search) ? saveCont(search, 'search') : null;
  }
  if (!cont) cont = endlessCont(items, historySeeds);
  return { items, cont, chips };
}

// ---- Wiedergabeseite (Infos 5 Minuten zwischengespeichert) -----------------------------
const videoCache = new Map(); // key -> { at, promise }
function cachedVideo(id, list, index) {
  const key = `${id}|${list || ''}|${index || ''}|${isSignedIn() ? 'a' : 'l'}`;
  const hit = videoCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.promise;
  const promise = (async () => {
    const yt = await getYT();
    let info;
    if (list) {
      const ep = new YTNodes.NavigationEndpoint({ watchEndpoint: { videoId: id, playlistId: list, index: Number(index || 0) } });
      info = await yt.getInfo(ep);
    } else {
      info = await yt.getInfo(id);
    }
    return watchData(info, id);
  })().catch((e) => {
    videoCache.delete(key);
    throw e;
  });
  videoCache.set(key, { at: Date.now(), promise });
  if (videoCache.size > 100) videoCache.delete(videoCache.keys().next().value);
  return promise;
}

// ---- Shorts: Zwischenspeicher & Vorladen ---------------------------------------------
const shortMetaCache = new Map(); // id -> Promise
function shortMeta(id) {
  const hit = shortMetaCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.promise;
  const promise = loadShortMeta(id).catch((e) => {
    shortMetaCache.delete(id);
    throw e;
  });
  shortMetaCache.set(id, { at: Date.now(), promise });
  if (shortMetaCache.size > 300) shortMetaCache.delete(shortMetaCache.keys().next().value);
  return promise;
}

// Profilbild eines Kanals (für Shorts ohne Bild im Overlay), mit Zwischenspeicher.
const avatarCache = new Map(); // channelId -> Promise<string>
function channelAvatar(id) {
  if (!avatarCache.has(id)) {
    const p = (async () => {
      const yt = await getYT();
      const c = await Promise.race([yt.getChannel(id), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
      const h = c.header || {};
      return (
        thumb(c.metadata?.avatar, 88) ||
        thumb(h.author?.thumbnails, 88) ||
        thumb(findNode(h, 'DecoratedAvatarView')?.avatar, 88) ||
        thumb(findNode(h, 'AvatarView')?.image, 88) ||
        ''
      );
    })().catch(() => {
      setTimeout(() => avatarCache.delete(id), 60_000);
      return '';
    });
    avatarCache.set(id, p);
    if (avatarCache.size > 500) avatarCache.delete(avatarCache.keys().next().value);
  }
  return avatarCache.get(id);
}

// Lädt Infos und Stream-Adressen der nächsten Shorts schon im Hintergrund.
function prefetchShorts(ids) {
  for (const id of ids) {
    shortMeta(id).catch(() => {});
    resolveVideo(id).catch(() => {});
  }
}

async function loadShortMeta(id) {
  const yt = await getYT();
  const info = await yt.getShortsVideoInfo(id);
  const b = info.basic_info || {};
  const header = findNode(info.player_overlays, 'ReelPlayerHeader');
  const overlay = info.player_overlays || {};
  let avatar = thumb(header?.channel_thumbnail, 88);
  // Neueres Shorts-Layout: Profilbild steckt in einem Avatar-View-Model.
  if (!avatar) avatar = thumb(findNode(overlay, 'DecoratedAvatarView')?.avatar, 88) || thumb(findNode(overlay, 'AvatarView')?.image, 88);
  if (!avatar && b.channel_id) avatar = await channelAvatar(b.channel_id);
  let commentCount = '';
  const commentsBtn = findNode(overlay, 'ButtonView', (n) => /comment|kommentar/i.test(n.accessibility_text || n.icon_name || ''));
  if (commentsBtn) commentCount = commentsBtn.title || '';
  const sub = await subscribedState(b.channel_id, info);
  return {
    id,
    title: b.title || txt(header?.reel_title_text) || '',
    channel: { id: b.channel_id || '', name: b.author || txt(header?.channel_title_text) || '', avatar },
    likes: b.like_count ?? null,
    liked: !!b.is_liked || store.listOf('liked').some((v) => v.id === id),
    disliked: !!b.is_disliked,
    views: b.view_count ?? null,
    comments: commentCount,
    subscribed: sub,
    thumbnail: videoThumb(id, 'oar2')
  };
}

// ---- Hilfsfunktionen ----------------------------------------------------------
function publicAuth() {
  return {
    status: authState.status,
    method: authState.method,
    code: authState.code,
    url: authState.url,
    expires: authState.expires,
    error: authState.error,
    account: authState.account
  };
}

function localChannel(s) {
  return { type: 'channel', id: s.id, name: s.name, avatar: s.avatar, subscribers: '', videos: '', handle: '' };
}

function localPlaylistItem(p) {
  return { type: 'playlist', id: p.id, title: p.title, thumbnail: p.videos[0]?.thumbnail || '', count: `${p.videos.length} Videos`, channel: { name: 'Du' }, local: true, privacy: p.privacy };
}

function walkType(root, type, out, seen = new WeakSet()) {
  root = unwrap(root);
  if (!root || typeof root !== 'object' || seen.has(root)) return;
  seen.add(root);
  if (root.type === type) out.push(root);
  for (const v of Array.isArray(root) ? root : Object.values(root)) walkType(v, type, out, seen);
}

function findNode(root, type, pred) {
  const out = [];
  walkType(root, type, out);
  return pred ? out.find(pred) : out[0];
}

function commentsResult(c) {
  const items = (c.contents || []).map((t) => {
    const n = normalizeComment(t);
    if (n && t.has_replies) n.thread = saveCont(t, 'thread');
    if (n && isSignedIn() && t.comment) n.key = saveCont(t.comment, 'cview');
    return n;
  }).filter(Boolean);
  return { items, cont: hasCont(c) ? saveCont(c, 'comments') : null };
}

function historyResult(h) {
  const sections = [];
  try {
    for (const s of h.sections || []) {
      const items = collectItems(s.contents);
      if (items.length) sections.push({ title: txt(s.header?.title), items });
    }
  } catch {}
  const items = sections.length ? [] : itemsFromFeed(h);
  return { sections, items, cont: hasCont(h) ? saveCont(h, 'history') : null };
}



async function resolveHandle(handle) {
  const yt = await getYT();
  const ep = await yt.resolveURL('https://www.youtube.com/' + handle);
  const id = ep?.payload?.browseId;
  if (!id) throw httpError(404, 'Kanal nicht gefunden');
  return id;
}

async function subscribedState(channelId, info) {
  if (isSignedIn() && info) {
    const btn = findNode(info.page || info, 'SubscribeButton');
    if (btn && typeof btn.subscribed === 'boolean') return btn.subscribed;
  }
  return store.isSubscribed(channelId);
}

function channelHeader(channel, id) {
  const m = channel.metadata || {};
  const h = channel.header;
  const out = {
    id: m.external_id || id,
    name: m.title || '',
    description: m.description || '',
    avatar: thumb(m.avatar || m.thumbnail, 240),
    banner: '',
    handle: '',
    subscribers: '',
    videos: '',
    verified: false,
    subscribed: store.isSubscribed(m.external_id || id),
    tabs: [],
    rss: m.rss_url || ''
  };
  if (m.vanity_channel_url) {
    const hm = m.vanity_channel_url.match(/\/(@[^/?]+)/);
    if (hm) out.handle = decodeURIComponent(hm[1]);
  }
  try {
    if (h?.type === 'PageHeader') {
      const c = h.content;
      out.name = txt(c?.title?.text) || out.name;
      out.banner = thumb(c?.banner?.image, 2560);
      const av = c?.image?.avatar?.image;
      if (av) out.avatar = thumb(av, 240);
      const parts = (c?.metadata?.metadata_rows || []).flatMap((r) => (r.metadata_parts || []).map((p) => txt(p.text))).filter(Boolean);
      for (const p of parts) {
        if (p.startsWith('@')) out.handle = p;
        else if (/abonnent|subscriber/i.test(p)) out.subscribers = p;
        else if (/video/i.test(p)) out.videos = p;
      }
    } else if (h?.type === 'C4TabbedHeader') {
      out.banner = thumb(h.banner, 2560);
      out.subscribers = txt(h.subscribers);
      out.videos = txt(h.videos_count);
      out.handle = txt(h.channel_handle) || out.handle;
      out.verified = !!h.author?.is_verified;
      if (h.author?.thumbnails?.length) out.avatar = thumb(h.author.thumbnails, 240);
    }
  } catch {}
  if (isSignedIn() && channel.subscribe_button && typeof channel.subscribe_button.subscribed === 'boolean') {
    out.subscribed = channel.subscribe_button.subscribed;
  }
  try {
    const names = channel.tabs || [];
    const map = { Videos: 'videos', Shorts: 'shorts', Live: 'streams', Playlists: 'playlists', Community: 'posts', Beiträge: 'posts', Posts: 'posts', Podcasts: 'podcasts', Releases: 'releases', Startseite: 'home', Home: 'home', Kanalinfo: 'about', About: 'about' };
    out.tabs = names.map((n) => map[n]).filter(Boolean);
  } catch {}
  if (!out.tabs.length) out.tabs = ['home', 'videos', 'shorts', 'streams', 'playlists', 'posts'];
  return out;
}

async function channelAbout(channel, head) {
  const about = { description: head.description, links: [], country: '', joined: '', views: '', subscribers: head.subscribers, videos: head.videos };
  try {
    const a = await channel.getAbout();
    const meta = findNode(a, 'AboutChannelView') || findNode(a, 'ChannelAboutFullMetadata') || a;
    about.description = txt(meta.description) || about.description;
    about.country = txt(meta.country);
    about.joined = txt(meta.joined_date);
    about.views = txt(meta.view_count);
    about.subscribers = txt(meta.subscriber_count) || about.subscribers;
    about.videos = txt(meta.video_count) || about.videos;
    for (const l of meta.links || meta.primary_links || []) {
      const title = txt(l.title);
      const url = txt(l.link) || l.endpoint?.payload?.url || '';
      if (title || url) about.links.push({ title, url: url.startsWith('http') ? url : 'https://' + url, favicon: thumb(l.favicon, 32) });
    }
  } catch {}
  about.descriptionHtml = textToHtml(about.description);
  return about;
}

async function watchData(info, id) {
  const b = info.basic_info || {};
  const p = info.primary_info;
  const s = info.secondary_info;
  const owner = s?.owner;
  const channelId = owner?.author?.id || b.channel_id || '';

  // Kapitel aus der Fortschrittsleiste oder dem Beschreibungs-Panel.
  const chapters = [];
  const chapterNodes = [];
  walkType(info.player_overlays, 'Chapter', chapterNodes);
  if (chapterNodes.length) {
    for (const c of chapterNodes) chapters.push({ title: txt(c.title), start: Math.floor((c.time_range_start_millis || 0) / 1000), thumbnail: thumb(c.thumbnail, 320) });
  } else {
    const macro = [];
    walkType(info.engagement_panels, 'MacroMarkersListItem', macro);
    for (const m of macro) {
      const start = m.on_tap_endpoint?.payload?.startTimeSeconds;
      if (start != null) chapters.push({ title: txt(m.title), start: Number(start), thumbnail: thumb(m.thumbnail, 320) });
    }
  }
  const seenStarts = new Set();
  const uniqueChapters = chapters.filter((c) => !seenStarts.has(c.start) && seenStarts.add(c.start)).sort((a, c) => a.start - c.start);

  const heat = (info.heat_map?.heat_markers || []).map((m) => [m.time_range_start_millis / 1000, m.heat_marker_intensity_score_normalized]);

  let playlist = null;
  if (info.playlist) {
    const pl = info.playlist;
    playlist = {
      id: pl.id,
      title: txt(pl.title),
      author: txt(pl.author),
      current: pl.current_index ?? null,
      total: pl.total_items ?? null,
      items: collectItems(pl.contents)
    };
  }

  const subButton = s?.subscribe_button;
  const subscribed = isSignedIn() && subButton && typeof subButton.subscribed === 'boolean' ? subButton.subscribed : store.isSubscribed(channelId);
  const descriptionHtml = s?.description ? textToHtml(s.description) : escapeHtml(b.short_description || '').replace(/\n/g, '<br>');

  const related = collectItems(info.watch_next_feed);
  let commentCount = '';
  try {
    commentCount = txt(info.comments_entry_point_header?.comment_count);
  } catch {}

  const metadataRows = [];
  try {
    for (const r of s?.metadata?.rows || []) {
      const title = txt(r.title);
      const contents = (r.contents || []).map(txt).filter(Boolean).join(', ');
      if (title && contents) metadataRows.push({ title, value: contents });
    }
  } catch {}

  return {
    id,
    title: txt(p?.title) || b.title || '',
    views: txt(p?.view_count?.view_count) || (b.view_count != null ? `${formatNumberDe(b.view_count)} Aufrufe` : ''),
    shortViews: txt(p?.view_count?.short_view_count),
    viewCount: b.view_count ?? null,
    published: txt(p?.published) || b.publish_date || '',
    relativeDate: txt(p?.relative_date),
    likes: b.like_count ?? null,
    liked: !!b.is_liked || (!isSignedIn() && store.listOf('liked').some((v) => v.id === id)),
    disliked: !!b.is_disliked,
    duration: b.duration || 0,
    durationText: formatDuration(b.duration),
    live: !!b.is_live,
    upcoming: !!b.is_upcoming,
    category: b.category || '',
    keywords: b.keywords || [],
    superTitle: p?.super_title_link ? textToHtml(p.super_title_link) : '',
    channel: {
      id: channelId,
      name: owner?.author?.name || b.author || '',
      avatar: thumb(owner?.author?.thumbnails, 176),
      subscribers: txt(owner?.subscriber_count),
      verified: !!owner?.author?.is_verified
    },
    subscribed,
    descriptionHtml,
    metadataRows,
    chapters: uniqueChapters,
    heat,
    playlist,
    related,
    relatedCont: info.wn_has_continuation ? saveCont(info, 'related') : endlessCont(related, [id]),
    commentCount,
    thumbnail: videoThumb(id, 'maxresdefault'),
    position: store.getPosition(id),
    autoplayId: info.autoplay_video_endpoint?.payload?.videoId || related.find((r) => r.type === 'video')?.id || null
  };
}
