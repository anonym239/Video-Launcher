// Abo-Feed ohne Anmeldung: lädt die öffentlichen RSS-Feeds der abonnierten Kanäle.
const TTL = 15 * 60 * 1000;
const cache = new Map(); // channelId -> { at, items }
const CONCURRENCY = 6;

const decode = (s) =>
  String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]*)"`));
  return m ? decode(m[1]) : '';
};

export function parseFeed(xml, channel) {
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const id = tag(e, 'yt:videoId');
    const link = attr(e, 'link', 'href');
    const views = Number(attr(e, 'media:statistics', 'views') || 0);
    const published = tag(e, 'published');
    return {
      type: /\/shorts\//.test(link) ? 'short' : 'video',
      id,
      title: tag(e, 'title'),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: '',
      durationSec: 0,
      views: views ? `${views.toLocaleString('de-DE')} Aufrufe` : '',
      publishedAt: Date.parse(published) || 0,
      published: '',
      live: false,
      upcoming: false,
      channel: { id: channel.id, name: tag(e, 'name') || channel.name, avatar: channel.avatar || '' },
      description: ''
    };
  }).filter((v) => v.id);
}

async function fetchChannel(ch) {
  const hit = cache.get(ch.id);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ch.id)}`, {
    headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'de-DE,de;q=0.9' }
  });
  if (!r.ok) throw new Error(`${ch.name || ch.id}: HTTP ${r.status}`);
  const items = parseFeed(await r.text(), ch);
  cache.set(ch.id, { at: Date.now(), items });
  return items;
}

export async function localSubscriptionFeed(subs, { shorts = false } = {}) {
  const queue = [...subs];
  const all = [];
  const errors = [];
  async function worker() {
    while (queue.length) {
      const ch = queue.shift();
      try {
        all.push(...(await fetchChannel(ch)));
      } catch (e) {
        errors.push(e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));
  const items = all
    .filter((v) => (shorts ? v.type === 'short' : true))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 300);
  return { items, errors };
}
