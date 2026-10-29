// Endlos-Feed: Wenn YouTube keine weiteren Seiten mehr liefert, werden immer neue
// Videos aus den "Ähnlichen Videos" bereits gezeigter Videos nachgeladen – so wie die
// YouTube-Startseite nie zu Ende ist.
import { collectItems } from './normalize.js';

const MAX_QUEUE = 300;
const PAGE_MIN = 8;

export class EndlessFeed {
  /**
   * @param {() => Promise<any>} getYT
   * @param {string[]} seeds – Video-IDs, deren ähnliche Videos geladen werden
   * @param {Iterable<string>} seen – bereits angezeigte Video-IDs (keine Duplikate)
   */
  constructor(getYT, seeds, seen = []) {
    this.getYT = getYT;
    this.queue = [...new Set(seeds)].filter(Boolean);
    this.used = new Set();
    this.seen = new Set(seen);
    this.fallbackQueries = ['Musik', 'Gaming', 'Nachrichten', 'Sport', 'Comedy', 'Wissen', 'Kochen', 'Technik', 'Reisen', 'Filme'];
    this.search = null;
  }

  get has_continuation() {
    return true;
  }

  #take(items) {
    const out = [];
    for (const item of items) {
      if (item.type !== 'video' || item.live || this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      out.push(item);
      if (this.queue.length < MAX_QUEUE && !this.used.has(item.id)) this.queue.push(item.id);
    }
    return out;
  }

  async next() {
    const yt = await this.getYT();
    const items = [];
    let attempts = 0;
    while (items.length < PAGE_MIN && attempts < 6) {
      attempts++;
      const id = this.queue.shift();
      if (id) {
        if (this.used.has(id)) continue;
        this.used.add(id);
        try {
          const info = await yt.getInfo(id);
          items.push(...this.#take(collectItems(info.watch_next_feed, { flatten: true })));
        } catch {
          /* einzelnes Video nicht verfügbar → nächstes */
        }
        continue;
      }
      // Keine Startpunkte mehr: über die Suche neue holen.
      try {
        if (this.search && this.search.has_continuation) {
          this.search = await this.search.getContinuation();
        } else {
          const q = this.fallbackQueries[Math.floor(Math.random() * this.fallbackQueries.length)];
          this.search = await yt.search(q, { type: 'video' });
        }
        items.push(...this.#take(collectItems(this.search.results, { flatten: true })));
      } catch {
        break;
      }
    }
    return items;
  }
}

// Mischt die Reihenfolge leicht, damit der Feed abwechslungsreich bleibt.
export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
