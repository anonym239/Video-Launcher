// Offline-Downloads: speichern, auflisten, abspielen (inkl. Spulen), löschen – ohne Internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-offline-'));
process.env.VL_DATA_DIR = dir;
const { createServer } = await import('../server/index.js');
const offline = await import('../server/offline.js');
const { store } = await import('../server/store.js');

let server;
let base;
const ID = 'abcdefghijk';
const SID = 'shortshort1';
const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  store.flush();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function* chunks() {
  yield bytes.subarray(0, 2000);
  yield bytes.subarray(2000);
}

async function waitDone(id) {
  for (let i = 0; i < 100; i++) {
    if (offline.getItem(id)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Download nicht fertig');
}

test('Download landet im App-Speicher und wird gelistet', async () => {
  offline.start(ID, { title: 'Mein Video', channel: { id: 'UC1', name: 'Kanal' }, label: '720p' }, async () => ({
    source: chunks(),
    size: bytes.length,
    audioOnly: false,
    height: 720,
    info: { basic_info: { duration: 125 } }
  }));
  await waitDone(ID);
  assert.ok(fs.existsSync(path.join(dir, 'offline', `${ID}.mp4`)));
  const r = await (await fetch(base + '/api/offline')).json();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].title, 'Mein Video');
  assert.equal(r.items[0].durationText, '2:05');
  assert.equal(r.items[0].label, '720p');
});

test('Streams kommen aus der Datei, Spulen per Range klappt', async () => {
  const s = await (await fetch(base + `/api/streams/${ID}`)).json();
  assert.equal(s.offline, true);
  assert.equal(s.progressive[0].url, `/offline/${ID}.mp4`);
  const full = await fetch(base + s.progressive[0].url);
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const part = await fetch(base + s.progressive[0].url, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${bytes.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200));
});

test('Videoseite ohne Internet zeigt den Download', async () => {
  const v = await (await fetch(base + `/api/video/${ID}`)).json();
  assert.equal(v.title, 'Mein Video');
  assert.equal(v.offline, true);
  assert.equal(v.channel.name, 'Kanal');
});

test('Shorts offline: Feed und Infos aus den Downloads', async () => {
  offline.start(SID, { title: 'Mein Short', short: true, channel: { id: 'UC2', name: 'K2' } }, async () => ({ source: chunks(), size: bytes.length, audioOnly: false, info: {} }));
  await waitDone(SID);
  const feed = await (await fetch(base + `/api/shorts?seed=${SID}`)).json();
  assert.equal(feed.ids[0], SID);
  const m = await (await fetch(base + `/api/short/${SID}`)).json();
  assert.equal(m.title, 'Mein Short');
});

test('Ungültige Dateinamen werden nicht ausgeliefert', async () => {
  for (const p of ['/offline/..%2Foffline.json', '/offline/abc.mp4', `/offline/${ID}.json`]) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('Löschen entfernt Datei und Eintrag', async () => {
  const r = await fetch(base + `/api/offline/${ID}`, { method: 'DELETE', headers: { 'x-vl': '1' } });
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(path.join(dir, 'offline', `${ID}.mp4`)));
  const list = await (await fetch(base + '/api/offline')).json();
  assert.ok(!list.items.some((i) => i.id === ID));
});
