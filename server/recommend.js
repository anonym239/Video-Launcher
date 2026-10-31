// "Für dich"-Empfehlungen ohne Google-Konto: aus dem lokalen Verlauf (ähnliche Videos),
// den lokalen Abos (neueste Uploads) und YouTubes allgemeiner Startseite gemischt.
import { collectItems } from './normalize.js';

const SEEDS = 5; // so viele zuletzt gesehene Videos dienen als Ausgangspunkt
const PER_SEED = 12;
const DISCOVER_TOPICS = ['Musik neu', 'Gaming', 'Comedy', 'Wissen Doku', 'Sport Highlights', 'Kochen', 'Technik', 'Film Trailer'];

// Verschränkt mehrere Listen abwechselnd (a1, b1, c1, a2, b2 …).
export function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

// Entfernt Doppelte, bereits Gesehenes und Livestreams.
export function cleanup(items, watched = new Set()) {
  const seen = new Set();
  return items.filter((v) => {
    if (!v || v.type !== 'video' || !v.id || v.live) return false;
    if (seen.has(v.id) || watched.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

async function relatedOf(yt, id) {
  try {
    const info = await yt.getInfo(id);
    return collectItems(info.watch_next_feed, { flatten: true }).slice(0, PER_SEED);
  } catch {
    return [];
  }
}

/**
 * Baut die erste Seite der Empfehlungen.
 * @returns {Promise<{items: object[], seeds: string[]}>}
 */
export async function forYou(yt, { history = [], subsFeed = async () => [], homeItems = [] } = {}) {
  const watched = new Set(history.map((v) => v.id));
  const seeds = history.filter((v) => !v.short).slice(0, SEEDS).map((v) => v.id);

  const [related, subs] = await Promise.all([
    Promise.all(seeds.map((id) => relatedOf(yt, id))),
    subsFeed().catch(() => [])
  ]);
  // Neue Abo-Videos (letzte 7 Tage) nach vorn.
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const freshSubs = subs.filter((v) => v.type === 'video' && (!v.publishedAt || v.publishedAt > weekAgo)).slice(0, 10);

  let items = cleanup(interleave([...related, freshSubs, homeItems.filter((i) => i.type === 'video')]), watched);

  if (items.length < 8) {
    // Kaum Verlauf/Abos: abwechslungsreiche Mischung aus beliebten Videos mehrerer Themen.
    const topics = [...DISCOVER_TOPICS].sort(() => Math.random() - 0.5).slice(0, 4);
    const lists = await Promise.all(topics.map((t) => yt.search(t, { type: 'video', upload_date: 'week', prioritize: 'popularity' }).then((s) => collectItems(s.results, { flatten: true })).catch(() => [])));
    items = cleanup([...items, ...interleave(lists)], watched);
  }
  return { items, seeds: [...seeds, ...items.slice(0, 20).map((v) => v.id)] };
}
