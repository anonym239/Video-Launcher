import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EndlessFeed } from '../server/endless.js';

// Jedes Video hat 5 "ähnliche Videos" – IDs werden fortlaufend erzeugt.
let counter = 0;
const id = (n) => `v${String(n).padStart(10, '0')}`;
const fakeYT = {
  calls: 0,
  async getInfo() {
    this.calls++;
    return { watch_next_feed: Array.from({ length: 5 }, () => ({ type: 'CompactVideo', video_id: id(++counter), title: { text: 'x' }, thumbnails: [], length_text: { text: '1:00' } })) };
  },
  async search() {
    return { results: [], has_continuation: false };
  }
};

test('Endlos-Feed liefert immer neue Videos ohne Duplikate', async () => {
  const feed = new EndlessFeed(async () => fakeYT, [id(0)]);
  const all = [];
  for (let i = 0; i < 20; i++) {
    const page = await feed.next();
    assert.ok(page.length >= 8, `Seite ${i} zu klein: ${page.length}`);
    all.push(...page.map((v) => v.id));
  }
  assert.equal(new Set(all).size, all.length, 'keine doppelten Videos');
  assert.ok(feed.has_continuation);
});

test('Endlos-Feed fällt auf die Suche zurück, wenn es keine Startpunkte gibt', async () => {
  let searched = 0;
  const yt = {
    async getInfo() {
      throw new Error('nicht verfügbar');
    },
    async search() {
      searched++;
      return { results: [{ type: 'Video', video_id: id(1000 + searched), title: { text: 'Suche' }, thumbnails: [], length_text: { text: '2:00' } }], has_continuation: false };
    }
  };
  const feed = new EndlessFeed(async () => yt, []);
  const page = await feed.next();
  assert.ok(searched > 0);
  assert.ok(page.length > 0);
});
