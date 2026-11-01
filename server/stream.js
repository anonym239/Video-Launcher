// Ermittelt abspielbare Streams (DASH / HLS / progressiv) und leitet
// Video-Daten über den Handy-Server weiter (kein CORS-Problem, keine Werbung).
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { Constants } from 'youtubei.js';
import { getYT } from './yt.js';
import { store } from './store.js';
import { thumb, txt } from './normalize.js';

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // videoId -> { at, info, client, source, data }

const PROXY_BASE = 'http://vl.local';
const vp = (url, extra = '') => `/vp?u=${encodeURIComponent(url)}${extra}`;

// Nur diese Hosts dürfen über /vp geladen werden (kein offener Proxy).
export function isAllowedUpstream(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname;
  if (h.endsWith('.googlevideo.com')) return true;
  if (h === 'manifest.googlevideo.com') return true;
  if ((h === 'www.youtube.com' || h === 'youtube.com') && url.pathname.startsWith('/api/timedtext')) return true;
  return false;
}

const UA_BY_C = {
  IOS: Constants.CLIENTS.IOS?.USER_AGENT,
  ANDROID: Constants.CLIENTS.ANDROID?.USER_AGENT,
  ANDROID_VR: Constants.CLIENTS.ANDROID_VR?.USER_AGENT
};
const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function upstreamHeaders(url, range) {
  let c = '';
  try {
    c = new URL(url).searchParams.get('c') || '';
  } catch {}
  const h = {
    accept: '*/*',
    'user-agent': UA_BY_C[c] || DEFAULT_UA,
    origin: 'https://www.youtube.com',
    referer: 'https://www.youtube.com/'
  };
  if (range) h.range = range;
  return h;
}

let ytdlpPath;
function ytdlp() {
  if (ytdlpPath === undefined) {
    const r = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8' });
    ytdlpPath = r.status === 0 ? 'yt-dlp' : null;
  }
  return ytdlpPath;
}

function playable(info) {
  const st = info?.playability_status?.status;
  if (st && st !== 'OK') return false;
  const sd = info?.streaming_data;
  return !!(sd && (sd.adaptive_formats?.length || sd.formats?.length || sd.hls_manifest_url || sd.dash_manifest_url));
}

async function viaYoutubei(id) {
  const yt = await getYT();
  const clients = store.settings.clients?.length ? store.settings.clients : ['ANDROID_VR', 'TV', 'IOS', 'WEB'];
  let lastReason = '';
  for (const client of clients) {
    try {
      const info = await yt.getBasicInfo(id, { client });
      if (!playable(info)) {
        lastReason = info?.playability_status?.reason || info?.playability_status?.status || 'nicht abspielbar';
        if (info?.playability_status?.status === 'LOGIN_REQUIRED' && /privat|private/i.test(lastReason)) break;
        continue;
      }
      // Testweise eine URL entschlüsseln – schlägt das fehl, nächsten Client probieren.
      const f = info.streaming_data.adaptive_formats?.[0] || info.streaming_data.formats?.[0];
      if (f) await f.decipher(yt.session.player);
      return { info, client, source: 'youtubei' };
    } catch (e) {
      lastReason = e?.message || String(e);
    }
  }
  const err = new Error(lastReason || 'Video nicht verfügbar');
  err.status = 403;
  throw err;
}

function viaYtdlp(id) {
  return new Promise((resolve, reject) => {
    const bin = ytdlp();
    if (!bin) return reject(new Error('yt-dlp nicht installiert'));
    const p = spawn(bin, ['-J', '--no-warnings', '--no-playlist', '--', `https://www.youtube.com/watch?v=${id}`]);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || 'yt-dlp Fehler'));
      try {
        resolve({ data: JSON.parse(out), source: 'yt-dlp', client: 'yt-dlp' });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function resolveVideo(id, { fresh = false } = {}) {
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit;
  let res;
  try {
    res = await viaYoutubei(id);
  } catch (e) {
    if (!ytdlp()) throw e;
    try {
      res = await viaYtdlp(id);
    } catch {
      throw e;
    }
  }
  res.at = Date.now();
  cache.set(id, res);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return res;
}

function qualityLabel(f) {
  return f.quality_label || (f.height ? `${f.height}p` : '') || f.quality || '';
}

export async function streamsFor(id) {
  const r = await resolveVideo(id);
  if (r.source === 'yt-dlp') return streamsFromYtdlp(id, r);
  const yt = await getYT();
  const { info } = r;
  const sd = info.streaming_data;
  const basic = info.basic_info || {};
  const live = !!basic.is_live;

  const progressive = [];
  for (const f of sd.formats || []) {
    try {
      const url = await f.decipher(yt.session.player);
      if (url) progressive.push({ itag: f.itag, label: qualityLabel(f), mime: f.mime_type, url: vp(url, `&vid=${id}`) });
    } catch {}
  }
  const audio = [];
  for (const f of (sd.adaptive_formats || []).filter((x) => x.has_audio && !x.has_video && /mp4/.test(x.mime_type))) {
    try {
      const url = await f.decipher(yt.session.player);
      if (url) audio.push({ itag: f.itag, label: `${Math.round((f.bitrate || 0) / 1000)} kbit/s`, mime: f.mime_type, url: vp(url, `&vid=${id}`) });
    } catch {}
  }

  const captions = (info.captions?.caption_tracks || []).map((c) => ({
    lang: c.language_code,
    label: txt(c.name) + (c.kind === 'asr' ? ' (automatisch)' : ''),
    auto: c.kind === 'asr',
    url: vp(addParam(c.base_url, 'fmt', 'vtt'))
  }));

  let storyboard = null;
  const boards = info.storyboards?.boards;
  if (Array.isArray(boards) && boards.length) {
    const b = boards[boards.length - 1];
    storyboard = {
      template: b.template_url,
      width: b.thumbnail_width,
      height: b.thumbnail_height,
      count: b.thumbnail_count,
      interval: b.interval,
      columns: b.columns,
      rows: b.rows
    };
  }

  const hasAdaptive = (sd.adaptive_formats || []).length > 0 && !live;
  return {
    id,
    client: r.client,
    source: r.source,
    live,
    duration: basic.duration || 0,
    title: basic.title || '',
    thumbnail: thumb(basic.thumbnail, 1280),
    dash: hasAdaptive ? `/api/manifest/${id}.mpd` : null,
    hls: sd.hls_manifest_url ? vp(sd.hls_manifest_url) : null,
    progressive,
    audio,
    captions,
    storyboard
  };
}

function streamsFromYtdlp(id, r) {
  const d = r.data;
  const formats = d.formats || [];
  const progressive = formats
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && /^https?$/.test(f.protocol || '') && f.url)
    .map((f) => ({ itag: Number(f.format_id) || 0, label: f.height ? `${f.height}p` : f.format_note || '', mime: `video/${f.ext}`, url: vp(f.url) }));
  const hlsFormat = formats.find((f) => /m3u8/.test(f.protocol || '') && f.manifest_url);
  const audio = formats
    .filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && f.ext === 'm4a' && f.url)
    .map((f) => ({ itag: Number(f.format_id) || 0, label: `${Math.round(f.abr || 0)} kbit/s`, mime: 'audio/mp4', url: vp(f.url) }));
  const captions = Object.entries(d.subtitles || {}).flatMap(([lang, list]) => {
    const v = list.find((x) => x.ext === 'vtt');
    return v ? [{ lang, label: lang, auto: false, url: vp(v.url) }] : [];
  });
  return {
    id,
    client: 'yt-dlp',
    source: 'yt-dlp',
    live: !!d.is_live,
    duration: d.duration || 0,
    title: d.title || '',
    thumbnail: d.thumbnail || '',
    dash: null,
    hls: hlsFormat ? vp(hlsFormat.manifest_url) : null,
    progressive,
    audio,
    captions,
    storyboard: null
  };
}

function addParam(url, k, v) {
  try {
    const u = new URL(url);
    u.searchParams.set(k, v);
    return u.href;
  } catch {
    return url;
  }
}

export async function dashManifest(id) {
  const r = await resolveVideo(id);
  if (r.source !== 'youtubei') throw Object.assign(new Error('Kein DASH verfügbar'), { status: 404 });
  const mpd = await r.info.toDash({
    url_transformer: (url) => new URL(PROXY_BASE + vp(url.toString(), `&vid=${id}`))
  });
  return mpd.split(PROXY_BASE).join('');
}

// HLS-Playlists umschreiben, damit auch Segmente über den Proxy laufen.
export function rewriteM3U8(body, baseUrl) {
  const abs = (u) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  return body
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (!l) return line;
      if (l.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (m, u) => `URI="${vp(abs(u))}"`);
      }
      return vp(abs(l));
    })
    .join('\n');
}

// ---- Abgelaufene Stream-Links automatisch erneuern ---------------------------------
// googlevideo-Links laufen ab bzw. werden nach einiger Zeit mit 403 abgelehnt. Früher
// hat der Player dann das ganze Video neu geladen (kurzer Aussetzer alle paar
// Sekunden). Jetzt holt der Server still einen frischen Link für dasselbe Format
// (gleiche itag + Tonspur) und liefert die angefragten Bytes einfach weiter.
const remap = new Map(); // `${vid}|${itag}|${xtags}` -> { url, at }
const refreshing = new Map(); // vid -> Promise

function formatKey(vid, url) {
  try {
    const u = new URL(url);
    return `${vid}|${u.searchParams.get('itag') || ''}|${u.searchParams.get('xtags') || ''}`;
  } catch {
    return null;
  }
}

export async function freshUrlFor(vid, oldUrl) {
  const key = formatKey(vid, oldUrl);
  if (!key) return null;
  const known = remap.get(key);
  // Kürzlich erneuert → diesen Link verwenden statt YouTube erneut zu fragen.
  if (known && known.url !== oldUrl && Date.now() - known.at < 30_000) return known.url;
  if (!refreshing.has(vid)) {
    refreshing.set(vid, resolveVideo(vid, { fresh: true }).finally(() => setTimeout(() => refreshing.delete(vid), 5000)));
  }
  let r;
  try {
    r = await refreshing.get(vid);
  } catch {
    return null;
  }
  if (r.source !== 'youtubei') return null;
  const [, itag, xtags] = key.split('|');
  const sd = r.info.streaming_data || {};
  const all = [...(sd.adaptive_formats || []), ...(sd.formats || [])];
  const cands = all.filter((f) => String(f.itag) === itag);
  const f = cands.find((x) => (x.xtags || '') === xtags) || cands.find((x) => (x.url || '').includes(xtags)) || cands[0];
  if (!f) return null;
  try {
    const yt = await getYT();
    const url = await f.decipher(yt.session.player);
    if (!url) return null;
    remap.set(key, { url, at: Date.now() });
    if (remap.size > 500) remap.delete(remap.keys().next().value);
    return url;
  } catch {
    return null;
  }
}

async function fetchUpstream(target, range, signal) {
  let url = target;
  let upstream;
  // Manuelle Weiterleitungen, damit jedes Ziel geprüft wird.
  for (let i = 0; i < 5; i++) {
    upstream = await fetch(url, { headers: upstreamHeaders(url, range), redirect: 'manual', signal });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      const next = new URL(upstream.headers.get('location'), url).href;
      if (!isAllowedUpstream(next)) throw new Error('Weiterleitung auf unerlaubten Host');
      url = next;
      continue;
    }
    break;
  }
  return { upstream, url };
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

// /vp?u=<googlevideo-URL> – leitet Bytes inkl. Range-Anfragen durch.
export async function proxy(req, res, query) {
  const target = query.get('u');
  if (!target || !isAllowedUpstream(target)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('Ungültige Ziel-URL');
  }
  const ctrl = new AbortController();
  req.on('close', () => ctrl.abort());
  let upstream;
  let url = target;
  const vid = query.get('vid');
  try {
    // Schon einmal erneuert? Dann gleich den frischen Link nehmen.
    const key = vid && formatKey(vid, target);
    const known = key && remap.get(key);
    if (known && Date.now() - known.at < 5 * 60 * 60 * 1000) url = known.url;
    ({ upstream, url } = await fetchUpstream(url, req.headers.range, ctrl.signal));
    if ((upstream.status === 403 || upstream.status === 410) && vid && /^[A-Za-z0-9_-]{11}$/.test(vid)) {
      upstream.body?.cancel().catch(() => {});
      const fresh = await freshUrlFor(vid, url);
      if (fresh && !ctrl.signal.aborted) ({ upstream, url } = await fetchUpstream(fresh, req.headers.range, ctrl.signal));
    }
  } catch (e) {
    if (ctrl.signal.aborted) return;
    res.writeHead(502, { 'content-type': 'text/plain' });
    return res.end('Upstream-Fehler: ' + e.message);
  }

  const type = upstream.headers.get('content-type') || '';
  if (/mpegurl/i.test(type) || /\.m3u8(\?|$)|\/hls_(playlist|variant)\//.test(new URL(url).pathname)) {
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
    return res.end(rewriteM3U8(text, url));
  }

  const headers = { 'cache-control': 'private, max-age=3600' };
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  const dl = query.get('dl');
  if (dl) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`;
  res.writeHead(upstream.status, headers);
  if (!upstream.body || req.method === 'HEAD') return res.end();
  const body = Readable.fromWeb(upstream.body);
  body.on('error', () => res.destroy());
  body.pipe(res);
}

export function invalidate(id) {
  if (id) cache.delete(id);
  else cache.clear();
}

// ---- Downloads bis 4K/8K ---------------------------------------------------------
// Hohe Qualitäten gibt es bei YouTube nur als getrennte Video- und Audiospur (MP4/DASH).
// Diese werden beim Herunterladen zu einer MP4-Datei zusammengefügt (server/mux.js).
function heightLabel(h, fps) {
  const tag = h >= 4320 ? ' (8K)' : h >= 2160 ? ' (4K)' : h >= 1440 ? ' (QHD)' : h >= 720 ? ' (HD)' : '';
  return `${h}p${fps > 30 ? fps : ''}${tag}`;
}

export async function downloadOptions(id) {
  const r = await resolveVideo(id);
  const options = [];
  if (r.source === 'youtubei') {
    const formats = r.info.streaming_data?.adaptive_formats || [];
    const audio = formats
      .filter((f) => f.has_audio && !f.has_video && /mp4/.test(f.mime_type) && !f.is_drc)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    // Pro Auflösung eine Variante: H.264 bevorzugt (läuft überall), sonst AV1.
    const byHeight = new Map();
    for (const f of formats) {
      if (!f.has_video || f.has_audio || !/^video\/mp4/.test(f.mime_type) || !f.height) continue;
      const codec = /av01/.test(f.mime_type) ? 'av01' : /avc1/.test(f.mime_type) ? 'avc1' : null;
      if (!codec) continue;
      const cur = byHeight.get(f.height);
      const better = !cur || (cur.codec === 'av01' && codec === 'avc1') || (cur.codec === codec && (f.fps || 0) > (cur.f.fps || 0));
      if (better) byHeight.set(f.height, { f, codec });
    }
    if (audio) {
      for (const [h, { f, codec }] of [...byHeight.entries()].sort((a, b) => b[0] - a[0])) {
        const size = Number(f.content_length || 0) + Number(audio.content_length || 0);
        options.push({
          kind: 'video',
          label: heightLabel(h, f.fps),
          sub: `MP4 · ${codec === 'av01' ? 'AV1' : 'H.264'}${size ? ` · ${formatSize(size)}` : ''}`,
          url: `/dl/${id}?v=${f.itag}&a=${audio.itag}`
        });
      }
      options.push({ kind: 'audio', label: `Nur Audio (${Math.round((audio.bitrate || 0) / 1000)} kbit/s)`, sub: `M4A${audio.content_length ? ` · ${formatSize(audio.content_length)}` : ''}`, url: `/dl/${id}?a=${audio.itag}` });
    }
  }
  if (!options.length) {
    const s = await streamsFor(id);
    for (const p of s.progressive) options.push({ kind: 'video', label: p.label, sub: p.mime.split(';')[0], url: p.url, direct: true });
    for (const a of s.audio) options.push({ kind: 'audio', label: `Nur Audio ${a.label}`, sub: 'audio/mp4', url: a.url, direct: true });
  }
  return { title: r.info?.basic_info?.title || r.data?.title || id, options };
}

function formatSize(bytes) {
  bytes = Number(bytes);
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// Öffnet einen Download als Byte-Strom (Video+Audio zusammengefügt oder nur Audio).
// Wird für /dl/… (Datei an den Browser) und für Offline-Downloads in der App genutzt.
export async function openDownload(id, { v, a, signal }) {
  const { muxMp4, fetchChunks } = await import('./mux.js');
  const r = await resolveVideo(id);
  if (r.source !== 'youtubei') throw Object.assign(new Error('Für dieses Video ist nur der einfache Download verfügbar.'), { status: 400 });
  const yt = await getYT();
  const formats = r.info.streaming_data?.adaptive_formats || [];
  const find = (itag) => formats.find((f) => String(f.itag) === String(itag));
  const vf = v ? find(v) : null;
  const af = find(a);
  if (!af || (v && !vf)) throw Object.assign(new Error('Format nicht gefunden'), { status: 404 });
  const title = (r.info.basic_info?.title || id).replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 120);
  const open = async (f) => {
    const url = await f.decipher(yt.session.player);
    return fetchChunks(url, { headers: upstreamHeaders(url), total: Number(f.content_length) || 0, signal });
  };
  const source = vf ? muxMp4(await open(vf), await open(af)) : await open(af);
  return {
    source,
    audioOnly: !vf,
    name: vf ? `${title} (${vf.height}p).mp4` : `${title}.m4a`,
    mime: vf ? 'video/mp4' : 'audio/mp4',
    size: (vf ? Number(vf.content_length || 0) : 0) + Number(af.content_length || 0),
    height: vf?.height || 0,
    info: r.info
  };
}

// /dl/ID?v=itag&a=itag – liefert die fertige Datei (Video+Audio zusammengefügt oder nur Audio).
export async function download(req, res, id, query) {
  const ctl = new AbortController();
  req.on('close', () => ctl.abort());
  const d = await openDownload(id, { v: query.get('v'), a: query.get('a'), signal: ctl.signal });
  res.writeHead(200, {
    'content-type': d.mime,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
    'cache-control': 'no-store',
    ...(d.audioOnly && d.size ? { 'content-length': String(d.size) } : {})
  });
  try {
    for await (const chunk of d.source) {
      if (!res.write(chunk)) await new Promise((ok) => res.once('drain', ok));
    }
    res.end();
  } catch (e) {
    if (!ctl.signal.aborted) console.error('[download]', e.message);
    res.destroy();
  }
}
