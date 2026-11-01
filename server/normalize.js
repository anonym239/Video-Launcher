// Wandelt die von youtubei.js geparsten YouTube-Knoten in einfache JSON-Objekte um,
// die das Frontend direkt rendern kann. Werbung wird hier herausgefiltert.

// Alle Knotentypen, die Werbung, Promotion oder Shopping sind.
const AD_TYPE = /(^Ad[A-Z]|AdSlot|AdLayout|InFeedAd|Promo|Promoted|Pyv|Sparkles|Mealbar|StatementBanner|BrandVideo|MerchandiseShelf|TicketShelf|PremiumUpsell|ProductList|ShoppingCarousel|^Ad$|AdsEngagementPanel|PlayerLegacyDesktopWatchAds)/;

// Schlüssel, in die der Walker nicht absteigt (Menüs, Endpunkte usw.).
const SKIP_KEYS = new Set([
  'menu', 'endpoint', 'endpoints', 'service_endpoint', 'service_endpoints', 'on_tap', 'on_tap_endpoint',
  'command', 'commands', 'accessibility', 'thumbnail_overlays', 'overlays', 'badges', 'header', 'sub_menu',
  'sort_menu', 'button', 'buttons', 'menu_button', 'renderer_context', 'subscribe_button', 'title', 'author',
  'thumbnails', 'thumbnail', 'image', 'metadata', 'navigation_endpoint', 'continuation_endpoint', 'on_response_received_endpoints'
]);

export function txt(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return String(t);
  if (typeof t.toString === 'function' && t.toString !== Object.prototype.toString) {
    const s = t.toString();
    if (s && s !== '[object Object]' && s !== 'N/A') return s;
  }
  if (typeof t.text === 'string') return t.text === 'N/A' ? '' : t.text;
  if (t.text && typeof t.text === 'object') return txt(t.text);
  if (typeof t.content === 'string') return t.content;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('');
  return '';
}

export function fixUrl(u) {
  if (!u) return '';
  u = String(u);
  if (u.startsWith('//')) return 'https:' + u;
  return u;
}

// Wählt aus einer Thumbnail-Liste das passende Bild (größtes bis maxWidth).
export function thumb(list, maxWidth = 720) {
  if (!list) return '';
  if (!Array.isArray(list)) {
    if (list.url) return fixUrl(list.url);
    if (Array.isArray(list.image)) return thumb(list.image, maxWidth);
    if (list.primary_thumbnail) return thumb(list.primary_thumbnail.image, maxWidth);
    if (list.avatar) return thumb(list.avatar.image, maxWidth);
    if (Array.isArray(list.thumbnails)) return thumb(list.thumbnails, maxWidth);
    return '';
  }
  const arr = list.filter((t) => t && t.url);
  if (!arr.length) return '';
  const sorted = [...arr].sort((a, b) => (b.width || 0) - (a.width || 0));
  const fit = sorted.find((t) => !t.width || t.width <= maxWidth) || sorted[sorted.length - 1];
  return fixUrl(fit.url);
}

export const videoThumb = (id, q = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;

export function parseDuration(text) {
  if (typeof text === 'number') return text;
  const m = String(text || '').trim().match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function browseIdOf(ep) {
  return ep?.payload?.browseId || '';
}

function urlOf(ep) {
  if (!ep) return '';
  return ep.metadata?.url || ep.payload?.url || ep.payload?.canonicalBaseUrl || '';
}

function endpointFromText(t) {
  if (!t) return null;
  if (t.endpoint) return t.endpoint;
  if (Array.isArray(t.runs)) return t.runs.find((r) => r.endpoint)?.endpoint || null;
  return null;
}

function authorOf(a, fallbackText) {
  if (a && typeof a === 'object' && ('name' in a || 'id' in a)) {
    const name = a.name && a.name !== 'N/A' ? a.name : txt(fallbackText);
    return {
      id: a.id && a.id !== 'N/A' ? a.id : browseIdOf(endpointFromText(fallbackText)),
      name: name || '',
      avatar: thumb(a.thumbnails, 176),
      verified: !!(a.is_verified || a.is_verified_artist),
      url: a.url || ''
    };
  }
  if (fallbackText) {
    return { id: browseIdOf(endpointFromText(fallbackText)), name: txt(fallbackText), avatar: '', verified: false };
  }
  return null;
}

function durationFromOverlays(overlays) {
  for (const o of overlays || []) {
    if (o?.type === 'ThumbnailOverlayTimeStatus') return txt(o.text);
    if (o?.type === 'ThumbnailOverlayBadgeView' || o?.type === 'ThumbnailBottomOverlayView') {
      for (const b of o.badges || []) {
        const t = txt(b.text);
        if (/^\d+(:\d{2}){1,2}$/.test(t)) return t;
        if (/live/i.test(t) || /LIVE/.test(b.badge_style || '')) return 'LIVE';
      }
    }
  }
  return '';
}

function isLiveText(t) {
  return /^(live|livestream|live jetzt|en directo|en direct|ao vivo)$/i.test(String(t).trim());
}

function videoBase(id, extra) {
  return {
    type: 'video',
    id,
    title: '',
    thumbnail: videoThumb(id),
    duration: '',
    durationSec: 0,
    views: '',
    published: '',
    live: false,
    upcoming: false,
    channel: null,
    description: '',
    ...extra
  };
}

function finalizeVideo(v) {
  if (v.duration === 'LIVE' || isLiveText(v.duration)) {
    v.live = true;
    v.duration = '';
  }
  v.durationSec = parseDuration(v.duration);
  // Videos ≤ 3 min im Hochformat erkennt man hier nicht sicher – daher nur explizite Shorts markieren.
  return v;
}

// Liest die Metadatenzeilen eines LockupView (neues YouTube-Layout).
function lockupRows(meta) {
  const rows = meta?.metadata?.metadata_rows || [];
  return rows.map((r) => (r.metadata_parts || []).map((p) => ({ text: txt(p.text), ep: endpointFromText(p.text) })));
}

function lockupToItem(n) {
  const id = n.content_id;
  const meta = n.metadata;
  const title = txt(meta?.title);
  const rows = lockupRows(meta);
  const img = n.content_image;
  const thumbUrl = thumb(img?.primary_thumbnail?.image || img?.image, 720);
  const avatarNode = meta?.image;
  const avatar = thumb(avatarNode?.avatar?.image || avatarNode?.avatars?.[0]?.image, 176);
  const channelRow = rows.find((r) => r.some((p) => browseIdOf(p.ep)?.startsWith('UC'))) || rows[0] || [];
  const channelPart = channelRow.find((p) => browseIdOf(p.ep)) || channelRow[0];
  const avatarEp = avatarNode?.renderer_context?.command_context?.on_tap;
  const channel = channelPart
    ? { id: browseIdOf(channelPart.ep) || browseIdOf(avatarEp), name: channelPart.text, avatar, verified: false }
    : null;
  const otherParts = rows.flat().filter((p) => p !== channelPart).map((p) => p.text).filter(Boolean);

  switch (n.content_type) {
    case 'VIDEO':
    case 'MOVIE':
    case 'CLIP': {
      let duration = '';
      try {
        duration = n.duration?.text || '';
      } catch {
        duration = '';
      }
      if (!duration) duration = durationFromOverlays(img?.overlays || img?.primary_thumbnail?.overlays);
      const views = otherParts.find((t) => /\d/.test(t) && /(aufruf|view|zuschau|watching|visualiz|vue)/i.test(t)) || otherParts[0] || '';
      const published = otherParts.find((t) => t !== views) || '';
      return finalizeVideo(videoBase(id, {
        title,
        thumbnail: thumbUrl || videoThumb(id),
        duration,
        views,
        published,
        channel
      }));
    }
    case 'SHORT':
      return { type: 'short', id, title, thumbnail: thumbUrl || videoThumb(id, 'oar2'), views: otherParts[0] || '' };
    case 'PLAYLIST':
    case 'PODCAST':
    case 'ALBUM':
    case 'COURSE':
    case 'SHOW': {
      let count = '';
      for (const o of img?.primary_thumbnail?.overlays || []) {
        for (const b of o.badges || []) count = count || txt(b.text);
      }
      return {
        type: 'playlist',
        id,
        title,
        thumbnail: thumbUrl,
        count,
        channel,
        mix: id?.startsWith('RD') || false,
        meta: otherParts.join(' • ')
      };
    }
    case 'CHANNEL':
      return { type: 'channel', id, name: title, avatar: thumbUrl || avatar, handle: '', subscribers: otherParts.join(' • '), videos: '', description: '' };
    default:
      return null;
  }
}

function postToItem(n) {
  const attachment = n.attachment;
  const images = [];
  let video = null;
  let poll = null;
  if (attachment) {
    if (attachment.type === 'BackstageImage') images.push(thumb(attachment.image, 1200));
    if (attachment.type === 'PostMultiImage') for (const i of attachment.images || []) images.push(thumb(i.image, 1200));
    if (['Video', 'CompactVideo', 'LockupView'].includes(attachment.type)) video = normalizeNode(attachment);
    if (attachment.type === 'Poll') poll = { total: txt(attachment.total_votes), choices: (attachment.choices || []).map((c) => txt(c.text)) };
  }
  return {
    type: 'post',
    id: n.id,
    channel: authorOf(n.author),
    content: textToHtml(n.content),
    published: txt(n.published),
    likes: txt(n.vote_count),
    images: images.filter(Boolean),
    video,
    poll
  };
}

// Normalisiert einen einzelnen Knoten. Gibt null zurück, wenn der Knoten kein Inhaltselement ist.
export function normalizeNode(n) {
  if (!n || typeof n !== 'object' || typeof n.type !== 'string') return null;
  const t = n.type;
  if (AD_TYPE.test(t)) return null;
  try {
    switch (t) {
      case 'Video':
      case 'CompactVideo':
      case 'GridVideo':
      case 'VideoCard':
      case 'PlaylistPanelVideo':
      case 'PlaylistVideo':
      case 'WatchCardCompactVideo':
      case 'EndScreenVideo': {
        const id = n.video_id || n.id;
        if (!id) return null;
        let duration = txt(n.length_text) || txt(n.duration?.text ?? n.duration) || durationFromOverlays(n.thumbnail_overlays);
        if (t === 'PlaylistVideo' && n.duration?.seconds) duration = formatDuration(n.duration.seconds);
        const views = txt(n.short_view_count) || txt(n.view_count) || txt(n.views) || '';
        const v = videoBase(id, {
          title: txt(n.title),
          thumbnail: thumb(n.thumbnails || n.thumbnail, 720) || videoThumb(id),
          duration,
          views: t === 'PlaylistVideo' ? txt(n.video_info) : views,
          published: txt(n.published),
          channel: authorOf(n.author, n.short_byline_text || n.long_byline_text || n.byline_text),
          description: txt(n.description_snippet) || (n.snippets ? txt(n.snippets[0]?.text) : ''),
          upcoming: !!n.upcoming
        });
        if (t === 'PlaylistVideo' || t === 'PlaylistPanelVideo') {
          v.index = txt(n.index);
          v.setVideoId = n.set_video_id || '';
        }
        if (t === 'PlaylistPanelVideo') v.selected = !!n.selected;
        // Der is_live-Getter meldet "live", sobald die Dauer-Einblendung fehlt – nur ohne Dauer vertrauen.
        try {
          if (!duration && n.is_live) v.live = true;
        } catch {}
        for (const b of n.badges || []) {
          const l = txt(b.label);
          if (/live/i.test(l) || b.style === 'BADGE_STYLE_TYPE_LIVE_NOW') v.live = true;
        }
        return finalizeVideo(v);
      }
      case 'ReelItem':
        return { type: 'short', id: n.id, title: txt(n.title), thumbnail: thumb(n.thumbnails, 720) || videoThumb(n.id, 'oar2'), views: txt(n.views) };
      case 'ShortsLockupView': {
        const id = n.on_tap_endpoint?.payload?.videoId || String(n.entity_id || '').replace(/^shorts-shelf-item-/, '');
        if (!id) return null;
        return {
          type: 'short',
          id,
          title: txt(n.overlay_metadata?.primary_text) || n.accessibility_text || '',
          thumbnail: thumb(n.thumbnail_view_model?.image || n.thumbnail, 720) || videoThumb(id, 'oar2'),
          views: txt(n.overlay_metadata?.secondary_text)
        };
      }
      case 'LockupView':
        return lockupToItem(n);
      case 'Channel':
      case 'GridChannel':
      case 'CompactChannel': {
        const a = n.author || {};
        // In Suchergebnissen steht der @Handle oft im Feld "subscriber_count".
        const sub = txt(n.subscriber_count || n.subscribers);
        const vids = txt(n.video_count);
        const handle = sub.startsWith('@') ? sub : '';
        return {
          type: 'channel',
          id: n.id || a.id,
          name: a.name || txt(n.title),
          avatar: thumb(a.thumbnails || n.thumbnail, 240),
          verified: !!a.is_verified,
          handle,
          subscribers: handle ? vids : sub,
          videos: handle ? '' : vids,
          description: txt(n.description_snippet)
        };
      }
      case 'Playlist':
      case 'GridPlaylist':
      case 'CompactPlaylist':
      case 'GridMix':
      case 'Mix':
      case 'CompactMix':
      case 'GridShow': {
        const id = n.id || n.playlist_id;
        if (!id) return null;
        const author = n.author && typeof n.author === 'object' && 'name' in n.author ? authorOf(n.author) : (n.author ? { id: browseIdOf(endpointFromText(n.author)), name: txt(n.author), avatar: '' } : null);
        return {
          type: 'playlist',
          id,
          title: txt(n.title),
          thumbnail: thumb(n.thumbnails || n.thumbnail_renderer?.thumbnail || n.thumbnail, 720),
          count: txt(n.video_count_short) || txt(n.video_count),
          channel: author,
          mix: String(id).startsWith('RD'),
          firstVideoId: n.endpoint?.payload?.videoId || ''
        };
      }
      case 'BackstagePost':
      case 'Post':
      case 'SharedPost':
        return postToItem(n);
      default:
        return null;
    }
  } catch (e) {
    if (process.env.VL_DEBUG) console.warn('normalize', t, e);
    return null;
  }
}

// youtubei.js verpackt manche Felder in SuperParsedResult-Objekte (nur über Methoden lesbar).
export function unwrap(node) {
  if (node && typeof node === 'object' && typeof node.item === 'function' && typeof node.is_null === 'boolean') {
    if (node.is_null) return null;
    return node.is_array ? node.array() : node.item();
  }
  return node;
}

const SHELF_TYPES = new Set(['ReelShelf', 'RichShelf', 'Shelf', 'GridShelfView', 'HorizontalCardList']);

// Läuft in Dokumentreihenfolge durch einen geparsten Baum und sammelt Inhaltselemente.
const NEWS_SHELF = /eilmeldung|breaking|schlagzeile|nachrichten|news|meldungen|aktuelles|headlines/i;
export const NEWS_QUERY = /nachricht|news|eilmeldung|tagesschau|aktuell/i;

export function collectItems(root, opts = {}) {
  const out = [];
  const seen = new WeakSet();
  const ids = new Set();

  const push = (arr, item) => {
    const key = item.type + ':' + (item.id || item.title);
    if (item.id && ids.has(key)) return;
    if (item.id) ids.add(key);
    arr.push(item);
  };

  const walk = (node, arr, depth) => {
    node = unwrap(node);
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const c of node) walk(c, arr, depth + 1);
      return;
    }
    const type = node.type;
    if (typeof type === 'string') {
      if (AD_TYPE.test(type)) return;
      if (SHELF_TYPES.has(type) && !opts.flatten) {
        const children = [];
        const body = node.contents || node.items || node.content || node.cards;
        walk(body, children, depth + 1);
        if (!children.length) return;
        const title = txt(node.title) || txt(node.header?.title) || '';
        // „Eilmeldung“/„Top-Nachrichten“-Regale nie automatisch zeigen –
        // nur wenn ausdrücklich nach Nachrichten gesucht wird (opts.news).
        const anyTitle = [title, txt(node.header?.text), txt(node.header?.subtitle), txt(node.headline), txt(node.header?.title?.text)].join(' ');
        if (!opts.news && NEWS_SHELF.test(anyTitle)) return;
        const shorts = children.every((c) => c.type === 'short');
        arr.push({ type: 'shelf', title, shorts, items: children });
        return;
      }
      const item = normalizeNode(node);
      if (item) {
        push(arr, item);
        return;
      }
      if (type === 'ContinuationItem') return;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key) && typeof type === 'string') continue;
      const v = node[key];
      if (v && typeof v === 'object') walk(v, arr, depth + 1);
    }
  };

  walk(root, out, 0);
  return out;
}

// Wichtige Teile einer geparsten Seite in Reihenfolge.
export function pageRoots(page) {
  if (!page) return [];
  return [
    page.contents,
    page.continuation_contents,
    page.on_response_received_actions,
    page.on_response_received_commands
  ].filter(Boolean);
}

export function itemsFromFeed(feed, opts) {
  if (!feed) return [];
  let page;
  try {
    page = feed.page;
  } catch {
    page = null;
  }
  if (Array.isArray(page)) page = page[0];
  return collectItems(pageRoots(page), opts);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Wandelt YouTube-Weiterleitungslinks und interne Links in Links für diese App um.
export function rewriteLink(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://www.youtube.com');
    if (u.pathname === '/redirect' && u.searchParams.get('q')) return u.searchParams.get('q');
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      if (u.hostname === 'youtu.be') return `/watch?v=${u.pathname.slice(1)}${u.search ? '&' + u.search.slice(1) : ''}`;
      return u.pathname + u.search;
    }
    return u.href;
  } catch {
    return '';
  }
}

// Text mit Links/Zeitstempeln als sicheres HTML.
export function textToHtml(t) {
  if (t == null) return '';
  if (typeof t === 'string') return linkify(escapeHtml(t));
  const runs = Array.isArray(t.runs) && t.runs.length ? t.runs : [{ text: txt(t) }];
  return runs
    .map((r) => {
      if (r.emoji || r.type === 'EmojiRun') {
        const img = thumb(r.emoji?.image, 48);
        return img ? `<img class="emoji" src="${escapeHtml(img)}" alt="${escapeHtml(r.text || '')}">` : escapeHtml(r.text || '');
      }
      let s = escapeHtml(r.text || '');
      if (r.bold) s = `<b>${s}</b>`;
      if (r.italics) s = `<i>${s}</i>`;
      if (r.strikethrough) s = `<s>${s}</s>`;
      const ep = r.endpoint;
      if (ep) {
        const time = ep.payload?.startTimeSeconds;
        const href = rewriteLink(urlOf(ep) || (ep.payload?.videoId ? `/watch?v=${ep.payload.videoId}` : '') || (ep.payload?.browseId ? `/channel/${ep.payload.browseId}` : ''));
        if (href) {
          const internal = href.startsWith('/');
          const data = time != null && ep.payload?.videoId ? ` data-seek="${Number(time)}" data-video="${escapeHtml(ep.payload.videoId)}"` : '';
          return `<a href="${escapeHtml(href)}"${internal ? '' : ' target="_blank" rel="noopener noreferrer"'}${data}>${s}</a>`;
        }
      }
      return linkify(s);
    })
    .join('')
    .replace(/\n/g, '<br>');
}

function linkify(s) {
  return s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

// Kommentar-Thread -> JSON
export function normalizeComment(thread) {
  const c = thread?.comment || thread;
  if (!c || !c.comment_id) return null;
  return {
    id: c.comment_id,
    author: {
      id: c.author?.id || '',
      name: c.author?.name || '',
      avatar: thumb(c.author?.thumbnails, 88),
      verified: !!c.author?.is_verified,
      owner: !!c.author_is_channel_owner
    },
    content: textToHtml(c.content),
    published: c.published_time || '',
    likes: c.like_count || '',
    replies: Number(String(c.reply_count || '0').replace(/\D/g, '')) || 0,
    pinned: !!c.is_pinned,
    hearted: !!c.is_hearted,
    liked: !!c.is_liked,
    creatorAvatar: fixUrl(c.creator_thumbnail_url || ''),
    hasReplies: !!thread?.has_replies
  };
}

// ---- TV-Oberfläche (Anmeldung über den Geräte-Code) --------------------------------
// youtubei.js kennt die TV-Kacheln (tileRenderer) nicht – daher direkt aus dem rohen JSON.
const rawText = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join('') || '' : '');

export function itemsFromTvRaw(root) {
  const out = [];
  const ids = new Set();
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    const t = n.tileRenderer;
    if (t) {
      const type = t.contentType || '';
      const id = t.contentId || t.onSelectCommand?.watchEndpoint?.videoId || t.onSelectCommand?.reelWatchEndpoint?.videoId || '';
      const meta = t.metadata?.tileMetadataRenderer || {};
      const lines = (meta.lines || []).map((l) => (l.lineRenderer?.items || []).map((i) => rawText(i.lineItemRenderer?.text)).filter((x) => x && x.trim() !== '•'));
      const header = t.header?.tileHeaderRenderer || {};
      const thumbs = header.thumbnail?.thumbnails || [];
      let duration = '';
      for (const o of header.thumbnailOverlays || []) {
        const s = o.thumbnailOverlayTimeStatusRenderer;
        if (s) duration = rawText(s.text);
      }
      if (id && !ids.has(id) && /VIDEO|SHORT/.test(type)) {
        ids.add(id);
        const short = /SHORT/.test(type);
        const flat = lines.flat();
        out.push(short
          ? { type: 'short', id, title: rawText(meta.title), thumbnail: fixUrl(thumbs.slice(-1)[0]?.url) || videoThumb(id, 'oar2'), views: flat.find((x) => /\d/.test(x)) || '' }
          : {
              type: 'video', id, title: rawText(meta.title), thumbnail: videoThumb(id),
              duration: /^\d+(:\d{2}){1,2}$/.test(duration) ? duration : '', durationSec: parseDuration(duration),
              views: flat.find((x) => /aufruf|view/i.test(x)) || '', published: flat.find((x) => /vor |ago|\d{4}/i.test(x) && !/aufruf|view/i.test(x)) || '',
              live: /live/i.test(duration), upcoming: false, channel: lines[0]?.[0] ? { id: '', name: lines[0][0], avatar: '' } : null, description: ''
            });
      }
      return;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(root);
  return out;
}
