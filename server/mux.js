// Fügt eine Video- und eine Audiospur (fragmentiertes MP4 von YouTube/DASH) zu einer
// einzigen MP4-Datei zusammen – direkt beim Herunterladen, ohne ffmpeg und ohne die
// ganze Datei im Speicher zu halten. So sind Downloads bis 4K/8K möglich.

// ---- Box-Hilfen ---------------------------------------------------------------------
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf']);

export function parseBoxes(buf, start = 0, end = buf.length) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos, size, header, end: pos + size });
    pos += size;
  }
  return out;
}

function box(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

const child = (buf, parent, type) => parseBoxes(buf, parent.start + parent.header, parent.end).find((b) => b.type === type);

// Setzt die Track-ID in tkhd/trex/tfhd (rekursiv in Containern).
function retrack(buf, id) {
  const copy = Buffer.from(buf);
  const walk = (start, end) => {
    for (const b of parseBoxes(copy, start, end)) {
      const c = b.start + b.header;
      if (b.type === 'tkhd') copy.writeUInt32BE(id, c + (copy[c] === 1 ? 20 : 12));
      else if (b.type === 'trex' || b.type === 'tfhd') copy.writeUInt32BE(id, c + 4);
      else if (CONTAINERS.has(b.type)) walk(c, b.end);
    }
  };
  walk(0, copy.length);
  return copy;
}

function timescaleOf(moov, trak) {
  const mdhd = child(moov, child(moov, trak, 'mdia'), 'mdhd');
  const c = mdhd.start + mdhd.header;
  return moov.readUInt32BE(c + (moov[c] === 1 ? 20 : 12));
}

/** Baut aus zwei Init-Segmenten (moov) ein gemeinsames moov mit Track 1 = Video, Track 2 = Audio. */
export function mergeInit(videoMoov, audioMoov) {
  const vKids = parseBoxes(videoMoov, 8, videoMoov.length);
  const aKids = parseBoxes(audioMoov, 8, audioMoov.length);
  const vTrak = vKids.find((b) => b.type === 'trak');
  const aTrak = aKids.find((b) => b.type === 'trak');
  if (!vTrak || !aTrak) throw new Error('Spur im Init-Segment nicht gefunden');
  const slice = (buf, b) => buf.subarray(b.start, b.end);

  const mvhd = Buffer.from(slice(videoMoov, vKids.find((b) => b.type === 'mvhd')));
  mvhd.writeUInt32BE(3, mvhd.length - 4); // next_track_ID

  const vMvex = vKids.find((b) => b.type === 'mvex');
  const aMvex = aKids.find((b) => b.type === 'mvex');
  const vTrex = child(videoMoov, vMvex, 'trex');
  const aTrex = child(audioMoov, aMvex, 'trex');
  const mehd = child(videoMoov, vMvex, 'mehd');
  const mvex = box('mvex', ...(mehd ? [slice(videoMoov, mehd)] : []), retrack(slice(videoMoov, vTrex), 1), retrack(slice(audioMoov, aTrex), 2));

  const moov = box('moov', mvhd, retrack(slice(videoMoov, vTrak), 1), retrack(slice(audioMoov, aTrak), 2), mvex);
  return {
    moov,
    timescales: { 1: timescaleOf(videoMoov, vTrak), 2: timescaleOf(audioMoov, aTrak) },
    codec: videoMoov.includes(Buffer.from('av01')) ? 'av01' : 'avc1'
  };
}

export function ftyp(codec) {
  const brands = ['isom', 'iso6', 'iso2', 'mp41', codec === 'av01' ? 'av01' : 'avc1'];
  return box('ftyp', Buffer.from('isom', 'latin1'), Buffer.from([0, 0, 2, 0]), Buffer.from(brands.join(''), 'latin1'));
}

/** Passt ein Fragment (moof) an: neue Track- und Sequenznummer; liefert die Startzeit (tfdt). */
export function patchFragment(moof, trackId, sequence) {
  const out = retrack(moof, trackId);
  let decodeTime = 0;
  const walk = (start, end) => {
    for (const b of parseBoxes(out, start, end)) {
      const c = b.start + b.header;
      if (b.type === 'mfhd') out.writeUInt32BE(sequence, c + 4);
      else if (b.type === 'tfhd' && out.readUInt32BE(c) & 0x000001) {
        throw new Error('base-data-offset wird nicht unterstützt');
      } else if (b.type === 'tfdt') decodeTime = out[c] === 1 ? Number(out.readBigUInt64BE(c + 4)) : out.readUInt32BE(c + 4);
      else if (CONTAINERS.has(b.type)) walk(c, b.end);
    }
  };
  walk(0, out.length);
  return { moof: out, decodeTime };
}

// ---- Stream-Leser: liefert Box für Box aus einem Byte-Strom ------------------------------
export class BoxReader {
  constructor(iterable) {
    this.it = iterable[Symbol.asyncIterator]();
    this.buf = Buffer.alloc(0);
    this.done = false;
  }

  async #fill(n) {
    while (this.buf.length < n && !this.done) {
      const { value, done } = await this.it.next();
      if (done) this.done = true;
      else this.buf = this.buf.length ? Buffer.concat([this.buf, Buffer.from(value)]) : Buffer.from(value);
    }
    return this.buf.length >= n;
  }

  /** Nächste Box der obersten Ebene als { type, data } oder null am Ende. */
  async next() {
    if (!(await this.#fill(8))) return null;
    let size = this.buf.readUInt32BE(0);
    if (size === 1) {
      if (!(await this.#fill(16))) return null;
      size = Number(this.buf.readBigUInt64BE(8));
    }
    if (size < 8) throw new Error('Ungültige MP4-Box');
    if (!(await this.#fill(size))) throw new Error('Datei endet mitten in einer Box');
    const data = this.buf.subarray(0, size);
    this.buf = this.buf.subarray(size);
    return { type: data.toString('latin1', 4, 8), data };
  }
}

/**
 * Mischt Video und Audio zu einer MP4-Datei.
 * @param {AsyncIterable<Uint8Array>} videoStream
 * @param {AsyncIterable<Uint8Array>} audioStream
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* muxMp4(videoStream, audioStream) {
  const tracks = [
    { id: 1, reader: new BoxReader(videoStream) },
    { id: 2, reader: new BoxReader(audioStream) }
  ];
  // Init-Segmente (moov) beider Spuren lesen.
  for (const t of tracks) {
    for (;;) {
      const b = await t.reader.next();
      if (!b) throw new Error('Kein Init-Segment gefunden');
      if (b.type === 'moov') {
        t.moov = b.data;
        break;
      }
    }
  }
  const init = mergeInit(tracks[0].moov, tracks[1].moov);
  yield ftyp(init.codec);
  yield init.moov;

  // Nächstes Fragment (moof + mdat) einer Spur holen.
  const nextFragment = async (t) => {
    for (;;) {
      const b = await t.reader.next();
      if (!b) return null;
      if (b.type !== 'moof') continue; // sidx, styp, emsg … weglassen
      const mdat = await t.reader.next();
      if (!mdat || mdat.type !== 'mdat') throw new Error('mdat nach moof fehlt');
      return { moof: b.data, mdat: mdat.data };
    }
  };

  let seq = 1;
  const pending = new Map();
  for (const t of tracks) {
    const f = await nextFragment(t);
    if (f) pending.set(t.id, { t, f, time: patchFragment(f.moof, t.id, 0).decodeTime / init.timescales[t.id] });
  }
  // Immer das zeitlich frühere Fragment zuerst schreiben (Video und Audio verschränkt).
  while (pending.size) {
    const [id, cur] = [...pending.entries()].sort((a, b) => a[1].time - b[1].time)[0];
    const { moof } = patchFragment(cur.f.moof, id, seq++);
    yield moof;
    yield cur.f.mdat;
    const f = await nextFragment(cur.t);
    if (f) pending.set(id, { t: cur.t, f, time: patchFragment(f.moof, id, 0).decodeTime / init.timescales[id] });
    else pending.delete(id);
  }
}

// ---- Herunterladen in Stücken (YouTube drosselt große Einzelanfragen) -------------------
export async function* fetchChunks(url, { headers = {}, chunk = 8 * 1024 * 1024, total = 0, signal, fetchImpl = fetch } = {}) {
  let pos = 0;
  for (;;) {
    const end = total ? Math.min(pos + chunk, total) - 1 : pos + chunk - 1;
    const res = await fetchImpl(url, { headers: { ...headers, range: `bytes=${pos}-${end}` }, signal });
    if (res.status === 416) return;
    if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return;
    yield buf;
    pos += buf.length;
    const range = res.headers.get('content-range');
    const size = total || Number(range?.split('/')[1]) || 0;
    if (res.status === 200 || (size && pos >= size) || buf.length < end - (pos - buf.length) + 1) return;
  }
}
