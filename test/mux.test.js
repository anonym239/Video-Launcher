// Prüft das Zusammenfügen von Video- und Audiospur (Downloads bis 4K).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { muxMp4, parseBoxes, fetchChunks } from '../server/mux.js';

const fixture = (n) => new URL(`./fixtures/mux/${n}`, import.meta.url);

async function collect(gen) {
  const parts = [];
  for await (const c of gen) parts.push(c);
  return Buffer.concat(parts);
}

test('Video + Audio werden zu einer MP4 mit zwei Spuren', async () => {
  // Kleine Lesepuffer, damit Boxen über Stückgrenzen hinweg gelesen werden müssen.
  const out = await collect(muxMp4(fs.createReadStream(fixture('video.mp4'), { highWaterMark: 4096 }), fs.createReadStream(fixture('audio.mp4'), { highWaterMark: 3000 })));
  const top = parseBoxes(out).map((b) => b.type);
  assert.equal(top[0], 'ftyp');
  assert.equal(top[1], 'moov');
  assert.ok(!top.includes('sidx'), 'sidx wird entfernt');
  const moov = parseBoxes(out).find((b) => b.type === 'moov');
  const traks = parseBoxes(out, moov.start + 8, moov.end).filter((b) => b.type === 'trak');
  assert.equal(traks.length, 2);
  // Fragmente beider Spuren, verschränkt und fortlaufend nummeriert
  const moofs = parseBoxes(out).filter((b) => b.type === 'moof');
  const tracks = new Set();
  let seq = 0;
  for (const m of moofs) {
    for (const b of parseBoxes(out, m.start + 8, m.end)) {
      if (b.type === 'mfhd') {
        const s = out.readUInt32BE(b.start + 12);
        assert.equal(s, seq + 1);
        seq = s;
      }
      if (b.type === 'traf') {
        const tfhd = parseBoxes(out, b.start + 8, b.end).find((x) => x.type === 'tfhd');
        tracks.add(out.readUInt32BE(tfhd.start + 12));
      }
    }
  }
  assert.deepEqual([...tracks].sort(), [1, 2]);
  assert.equal(parseBoxes(out).filter((b) => b.type === 'mdat').length, moofs.length);
});

test('Download in Stücken über Range-Anfragen', async () => {
  const data = Buffer.alloc(25000, 7);
  const requests = [];
  const fakeFetch = async (url, { headers }) => {
    requests.push(headers.range);
    const [, a, b] = headers.range.match(/bytes=(\d+)-(\d+)/).map(Number);
    const part = data.subarray(a, Math.min(b + 1, data.length));
    return { ok: true, status: 206, headers: { get: () => `bytes ${a}-${a + part.length - 1}/${data.length}` }, arrayBuffer: async () => part };
  };
  const out = await collect(fetchChunks('https://x.googlevideo.com/v', { chunk: 10000, total: data.length, fetchImpl: fakeFetch }));
  assert.equal(out.length, data.length);
  assert.deepEqual(requests, ['bytes=0-9999', 'bytes=10000-19999', 'bytes=20000-24999']);
});
