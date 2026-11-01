// Offline-Downloads: Videos und Shorts werden im App-Speicher abgelegt
// (data/offline/, auf Android im privaten App-Ordner – nicht in der Galerie).
// Ohne Internet liefert der Server sie direkt aus: Liste, Vorschaubild,
// Profilbild und die Videodatei selbst (mit Range-Anfragen zum Spulen).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, JsonFile } from './store.js';

export const OFFLINE_DIR = path.join(DATA_DIR, 'offline');
fs.mkdirSync(OFFLINE_DIR, { recursive: true });

const index = new JsonFile('offline.json', () => ({ items: [] }));
if (!Array.isArray(index.data.items)) index.data.items = [];

const jobs = new Map(); // id -> { id, meta, bytes, total, ctl, error }
const ID = /^[\w-]{11}$/;

const fileOf = (item) => path.join(OFFLINE_DIR, `${item.id}.${item.audioOnly ? 'm4a' : 'mp4'}`);

function exists(item) {
  try {
    return fs.statSync(fileOf(item)).size > 0;
  } catch {
    return false;
  }
}

// Fertige Downloads (nur solche, deren Datei wirklich da ist).
export function items() {
  return index.data.items.filter(exists);
}

export function getItem(id) {
  const it = index.data.items.find((i) => i.id === id);
  return it && exists(it) ? it : null;
}

export function jobList() {
  return [...jobs.values()].map((j) => ({
    id: j.id,
    title: j.meta.title,
    short: j.meta.short,
    label: j.meta.label,
    bytes: j.bytes,
    total: j.total,
    error: j.error || null
  }));
}

/** Öffentliche Darstellung eines Downloads für die Oberfläche. */
export function publicItem(it) {
  return {
    type: 'video',
    id: it.id,
    title: it.title,
    channel: { id: it.channel?.id || '', name: it.channel?.name || '', avatar: it.hasAvatar ? `/offline/${it.id}.avatar.jpg` : '' },
    thumbnail: it.hasThumb ? `/offline/${it.id}.jpg` : '',
    duration: it.duration || 0,
    durationText: it.durationText || '',
    short: !!it.short,
    label: it.label || '',
    audioOnly: !!it.audioOnly,
    size: it.size || 0,
    addedAt: it.addedAt || 0,
    offline: true
  };
}

async function saveRemote(url, dest) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

function fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Startet einen Download in den App-Speicher.
 * open: async (signal) => { source: AsyncIterable<Uint8Array>, size, audioOnly, height, info }
 */
export function start(id, meta, open) {
  if (!ID.test(id)) throw Object.assign(new Error('Ungültige Video-ID'), { status: 400 });
  if (jobs.has(id) && !jobs.get(id).error) return jobs.get(id);
  const ctl = new AbortController();
  const job = { id, meta: { ...meta }, bytes: 0, total: 0, ctl, error: null };
  jobs.set(id, job);
  run(job, open).catch((e) => {
    if (ctl.signal.aborted) {
      jobs.delete(id);
      return;
    }
    console.error('[offline]', id, e.message);
    job.error = e.message || 'Download fehlgeschlagen';
  });
  return job;
}

async function run(job, open) {
  const { id } = job;
  const d = await open(job.ctl.signal);
  job.total = d.size || 0;
  const ext = d.audioOnly ? 'm4a' : 'mp4';
  const part = path.join(OFFLINE_DIR, `${id}.${ext}.part`);
  const out = fs.createWriteStream(part);
  try {
    for await (const chunk of d.source) {
      if (job.ctl.signal.aborted) throw new Error('abgebrochen');
      job.bytes += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
    }
    await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
  fs.renameSync(part, path.join(OFFLINE_DIR, `${id}.${ext}`));

  const b = d.info?.basic_info || {};
  const meta = job.meta;
  const short = !!meta.short;
  const thumbUrl = `https://i.ytimg.com/vi/${id}/${short ? 'oar2' : 'hqdefault'}.jpg`;
  let hasThumb = await saveRemote(thumbUrl, path.join(OFFLINE_DIR, `${id}.jpg`));
  if (!hasThumb && short) hasThumb = await saveRemote(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, path.join(OFFLINE_DIR, `${id}.jpg`));
  const avatarUrl = meta.channel?.avatar;
  const hasAvatar = /^https:\/\//.test(avatarUrl || '') ? await saveRemote(avatarUrl, path.join(OFFLINE_DIR, `${id}.avatar.jpg`)) : false;

  const st = fs.statSync(path.join(OFFLINE_DIR, `${id}.${ext}`));
  const duration = Number(b.duration) || Number(meta.duration) || 0;
  const item = {
    id,
    title: meta.title || b.title || id,
    channel: { id: meta.channel?.id || b.channel_id || '', name: meta.channel?.name || b.author || '' },
    duration,
    durationText: fmtDuration(duration),
    short,
    label: meta.label || (d.height ? `${d.height}p` : ''),
    audioOnly: !!d.audioOnly,
    size: st.size,
    hasThumb,
    hasAvatar,
    description: String(b.short_description || '').slice(0, 5000),
    addedAt: Date.now()
  };
  index.data.items = [item, ...index.data.items.filter((i) => i.id !== id)];
  index.flush();
  jobs.delete(id);
}

export function remove(id) {
  const job = jobs.get(id);
  if (job) {
    job.ctl.abort();
    jobs.delete(id);
  }
  for (const f of fs.readdirSync(OFFLINE_DIR)) {
    if (f.startsWith(`${id}.`)) fs.rmSync(path.join(OFFLINE_DIR, f), { force: true });
  }
  index.data.items = index.data.items.filter((i) => i.id !== id);
  index.flush();
}

const MIME = { mp4: 'video/mp4', m4a: 'audio/mp4', jpg: 'image/jpeg' };

/** /offline/<id>.(mp4|m4a|jpg|avatar.jpg) mit Range-Unterstützung (Spulen). */
export function serveOffline(req, res, name) {
  const m = String(name).match(/^([\w-]{11})\.(mp4|m4a|jpg|avatar\.jpg)$/);
  if (!m) {
    res.writeHead(404);
    return res.end();
  }
  const file = path.join(OFFLINE_DIR, name);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    res.writeHead(404);
    return res.end();
  }
  const type = MIME[name.split('.').pop()];
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${st.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/** Ist YouTube gerade erreichbar? (für den automatischen Offline-Modus) */
let lastCheck = { at: 0, online: true };
export async function isOnline() {
  if (Date.now() - lastCheck.at < 5000) return lastCheck.online;
  let online = false;
  try {
    const r = await fetch('https://www.youtube.com/generate_204', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    online = r.status < 500;
  } catch {
    online = false;
  }
  lastCheck = { at: Date.now(), online };
  return online;
}
