// Integrationstests für den lokalen Server (ohne Netzwerkzugriff auf YouTube).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-test-'));
process.env.VL_DATA_DIR = dir;
const { createServer, hostAllowed } = await import('../server/index.js');
const { store } = await import('../server/store.js');

let server;
let base;

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

const get = (p, headers = {}) => fetch(base + p, { headers });
const send = (method, p, body, headers = { 'x-vl': '1' }) =>
  fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

const video = { id: 'dQw4w9WgXcQ', title: 'Test', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', duration: '3:33', channel: { id: 'UCuAXFkgsw1L7xaCfnd5JJOw', name: 'Rick' } };

test('Host-Prüfung gegen DNS-Rebinding', () => {
  assert.ok(hostAllowed('localhost:8080', false));
  assert.ok(hostAllowed('127.0.0.1:8080', false));
  assert.ok(hostAllowed('[::1]:8080', false));
  assert.ok(!hostAllowed('evil.com', false));
  assert.ok(!hostAllowed('192.168.1.5:8080', false));
  assert.ok(hostAllowed('192.168.1.5:8080', true));
  assert.ok(!hostAllowed('evil.com', true));
  assert.ok(!hostAllowed(undefined, true));
});

test('Startseite und SPA-Routen liefern index.html', async () => {
  for (const p of ['/', '/watch?v=dQw4w9WgXcQ', '/shorts/aaaaaaaaaaa', '/@kanal', '/feed/subscriptions']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /<main id="app"/);
  }
});

test('Statische Dateien und Shaka werden ausgeliefert', async () => {
  let r = await get('/css/app.css');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/css/);
  r = await get('/js/app.js');
  assert.match(r.headers.get('content-type'), /javascript/);
  r = await get('/vendor/shaka-player.js');
  assert.equal(r.status, 200);
  r = await get('/js/../../server/store.js');
  assert.notEqual((await r.text()).includes('JsonFile'), true, 'Pfad-Traversal darf nicht funktionieren');
});

test('Fremder Host wird abgelehnt', async () => {
  // fetch() erlaubt keinen eigenen Host-Header → http.request verwenden.
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/status', headers: { host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('Schreibende Anfragen brauchen den Sicherheits-Header', async () => {
  const r = await send('POST', '/api/settings', { theme: 'light' }, {});
  assert.equal(r.status, 403);
});

test('Status & Einstellungen', async () => {
  let r = await get('/api/status');
  const s = await r.json();
  assert.equal(s.auth.status, 'signed_out');
  assert.equal(s.settings.lang, 'de');
  r = await send('POST', '/api/settings', { theme: 'light', autoplay: false, evil: 1 });
  const ns = await r.json();
  assert.equal(ns.theme, 'light');
  assert.equal(ns.autoplay, false);
  assert.equal(ns.evil, undefined);
});

test('Lokale Abos', async () => {
  let r = await send('POST', '/api/subscribe', { channel: { id: 'UCuAXFkgsw1L7xaCfnd5JJOw', name: 'Rick', avatar: '' }, on: true });
  assert.equal((await r.json()).subscribed, true);
  r = await get('/api/subscriptions');
  const subs = await r.json();
  assert.equal(subs.items.length, 1);
  assert.equal(subs.items[0].name, 'Rick');
  r = await send('POST', '/api/subscribe', { channel: { id: 'kaputt' }, on: true });
  assert.equal(r.status, 400);
  r = await send('POST', '/api/subscribe', { channel: { id: 'UCuAXFkgsw1L7xaCfnd5JJOw' }, on: false });
  r = await get('/api/subscriptions');
  assert.equal((await r.json()).items.length, 0);
});

test('Verlauf, Positionen und Pausieren', async () => {
  let r = await send('POST', '/api/history', { video });
  assert.equal(r.status, 200);
  r = await get('/api/feed/history');
  let h = await r.json();
  assert.equal(h.items[0].id, video.id);
  r = await get('/api/feed/history?q=nichtvorhanden');
  assert.equal((await r.json()).items.length, 0);

  await send('POST', '/api/position', { id: video.id, t: 42, d: 213 });
  r = await get(`/api/position/${video.id}`);
  assert.equal((await r.json()).t, 42);
  // Fast zu Ende → Position wird gelöscht
  await send('POST', '/api/position', { id: video.id, t: 210, d: 213 });
  r = await get(`/api/position/${video.id}`);
  assert.equal((await r.json()).t, 0);

  await send('POST', '/api/history/pause', { paused: true });
  await send('POST', '/api/history', { video: { ...video, id: 'aaaaaaaaaaa' } });
  r = await get('/api/feed/history');
  h = await r.json();
  assert.ok(!h.items.some((v) => v.id === 'aaaaaaaaaaa'), 'pausierter Verlauf darf nichts speichern');
  await send('POST', '/api/history/pause', { paused: false });

  r = await send('DELETE', `/api/history?id=${video.id}`);
  r = await get('/api/feed/history');
  assert.equal((await r.json()).items.length, 0);
  r = await send('POST', '/api/history', { video: { ...video, id: 'nope' } });
  assert.equal(r.status, 400);
});

test('Später ansehen, Mag ich und lokale Playlists', async () => {
  let r = await send('POST', '/api/save', { video, playlistId: 'WL', on: true });
  assert.equal(r.status, 200);
  r = await get('/api/playlist/WL');
  let pl = await r.json();
  assert.equal(pl.items.length, 1);
  assert.equal(pl.info.local, true);

  r = await send('POST', '/api/rate', { id: video.id, rating: 'like', video });
  r = await get('/api/playlist/LL');
  assert.equal((await r.json()).items.length, 1);
  await send('POST', '/api/rate', { id: video.id, rating: 'none', video });
  r = await get('/api/playlist/LL');
  assert.equal((await r.json()).items.length, 0);

  r = await send('POST', '/api/playlists', { title: 'Meine Liste', video });
  const created = await r.json();
  assert.ok(created.id.startsWith('LP'));
  r = await get(`/api/save-options/${video.id}`);
  const opts = (await r.json()).options;
  assert.ok(opts.find((o) => o.id === created.id).on);
  assert.ok(opts.find((o) => o.id === 'WL').on);

  await send('PATCH', `/api/playlists/${created.id}`, { title: 'Umbenannt' });
  r = await get(`/api/playlist/${created.id}`);
  pl = await r.json();
  assert.equal(pl.info.title, 'Umbenannt');
  assert.equal(pl.items[0].id, video.id);

  await send('POST', '/api/save', { video, playlistId: created.id, on: false });
  r = await get(`/api/playlist/${created.id}`);
  assert.equal((await r.json()).items.length, 0);

  r = await get('/api/library');
  const lib = await r.json();
  assert.equal(lib.watchLater.count, 1);
  assert.equal(lib.local.length, 1);

  await send('DELETE', `/api/playlists/${created.id}`);
  r = await get(`/api/playlist/${created.id}`);
  assert.equal(r.status, 404);
});

test('Backup exportieren und importieren', async () => {
  let r = await get('/api/backup');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const data = await r.json();
  data.subscriptions = [{ id: 'UCuAXFkgsw1L7xaCfnd5JJOw', name: 'Import', avatar: '' }];
  r = await send('POST', '/api/backup', data);
  assert.equal(r.status, 200);
  r = await get('/api/subscriptions');
  assert.equal((await r.json()).items[0].name, 'Import');
});

test('Proxy lehnt fremde Ziele ab, ungültige IDs werden abgefangen', async () => {
  let r = await get('/vp?u=' + encodeURIComponent('https://example.com/x'));
  assert.equal(r.status, 400);
  r = await get('/api/streams/kaputt');
  assert.equal(r.status, 400);
  r = await get('/api/video/..%2F..%2Fetc');
  assert.equal(r.status, 400);
  r = await get('/api/gibtsnicht');
  assert.equal(r.status, 404);
  r = await get('/api/related?cont=abgelaufen');
  assert.equal(r.status, 410);
});

test('Anmeldung: Cookie-Login prüft die Cookies', async () => {
  const r = await send('POST', '/api/auth/cookie', { cookie: 'foo=bar' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /SAPISID/);
  const s = await (await get('/api/auth/status')).json();
  assert.equal(s.status, 'signed_out');
});

test('Kommentieren ohne Anmeldung wird verweigert', async () => {
  const r = await send('POST', '/api/comment', { id: video.id, text: 'Hallo' });
  assert.equal(r.status, 401);
});
