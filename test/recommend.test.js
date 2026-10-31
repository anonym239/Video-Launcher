import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forYou, interleave, cleanup } from '../server/recommend.js';

const v = (id, extra = {}) => ({ type: 'video', id, title: id, ...extra });
const node = (id) => ({ type: 'CompactVideo', video_id: id, title: { text: id }, thumbnails: [], length_text: { text: '3:00' } });

test('interleave und cleanup', () => {
  assert.deepEqual(interleave([[1, 2, 3], ['a'], ['x', 'y']]), [1, 'a', 'x', 2, 'y', 3]);
  const out = cleanup([v('aaaaaaaaaaa'), v('aaaaaaaaaaa'), v('bbbbbbbbbbb', { live: true }), v('ccccccccccc'), { type: 'channel', id: 'x' }], new Set(['ccccccccccc']));
  assert.deepEqual(out.map((x) => x.id), ['aaaaaaaaaaa']);
});

test('Für dich: ähnliche Videos aus dem Verlauf + Abos, ohne Gesehenes', async () => {
  const yt = {
    async getInfo(id) {
      return { watch_next_feed: [node(id.slice(0, 5) + 'rel01'), node(id.slice(0, 5) + 'rel02'), node('seen0000001')] };
    },
    async search() {
      return { results: [] };
    }
  };
  const history = [v('seen0000001'), v('hist0000002'), v('shor0000003', { short: true })];
  const subs = [v('subs0000001', { publishedAt: Date.now() - 3600e3 }), v('subs0000002', { publishedAt: Date.now() - 30 * 86400e3 })];
  const res = await forYou(yt, { history, subsFeed: async () => subs, homeItems: [v('home0000001')] });
  const ids = res.items.map((x) => x.id);
  assert.ok(ids.includes('seen0rel01'), 'ähnliche Videos zum Verlauf');
  assert.ok(ids.includes('subs0000001'), 'neues Abo-Video');
  assert.ok(!ids.includes('subs0000002'), 'altes Abo-Video nicht vorn');
  assert.ok(!ids.includes('seen0000001'), 'bereits Gesehenes ausgeblendet');
  assert.ok(ids.includes('home0000001'));
  assert.ok(res.seeds.length > 0);
});

test('Für dich ohne Verlauf: Mischung aus mehreren Themen', async () => {
  let searches = 0;
  const yt = {
    async getInfo() {
      return { watch_next_feed: [] };
    },
    async search(q) {
      searches++;
      return { results: Array.from({ length: 5 }, (_, i) => ({ type: 'Video', video_id: `${String(searches).padStart(2, '0')}topic${i}xx`.slice(0, 11), title: { text: q }, thumbnails: [], length_text: { text: '1:00' } })) };
    }
  };
  const res = await forYou(yt, {});
  assert.equal(searches, 4);
  assert.ok(res.items.length >= 8);
  // Abwechselnd verschiedene Themen
  assert.notEqual(res.items[0].title, res.items[1].title);
});
