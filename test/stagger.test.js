// Versetzt-paralleles Anfragen der YouTube-Clients (schnellere Ladezeiten).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raceStaggered } from '../server/stream.js';

const wait = (ms, v, fail) => new Promise((ok, no) => setTimeout(() => (fail ? no(Object.assign(new Error(v), typeof fail === 'object' ? fail : {})) : ok(v)), ms));

test('schneller Client gewinnt, auch wenn der erste hängt', async () => {
  const t = Date.now();
  const r = await raceStaggered([() => wait(5000, 'langsam'), () => wait(10, 'schnell')], 50);
  assert.equal(r, 'schnell');
  assert.ok(Date.now() - t < 1000);
});

test('Fehler startet sofort den nächsten Client', async () => {
  const t = Date.now();
  const r = await raceStaggered([() => wait(5, 'x', true), () => wait(5, 'zwei')], 5000);
  assert.equal(r, 'zwei');
  assert.ok(Date.now() - t < 1000);
});

test('erster Client gewinnt, wenn er schnell genug ist (keine unnötigen Anfragen)', async () => {
  let started = 0;
  const r = await raceStaggered([() => (started++, wait(5, 'eins')), () => (started++, wait(5, 'zwei'))], 200);
  assert.equal(r, 'eins');
  await wait(250);
  assert.equal(started, 1);
});

test('alle scheitern → letzter Fehler; fatal bricht ab', async () => {
  await assert.rejects(raceStaggered([() => wait(1, 'a', true), () => wait(1, 'b', true)], 10), /b/);
  let second = false;
  await assert.rejects(raceStaggered([() => wait(1, 'privat', { fatal: true }), () => ((second = true), 'x')], 1000), /privat/);
  assert.equal(second, false);
});
