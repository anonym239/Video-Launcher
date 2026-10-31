// Persönlicher Shorts-Feed: startet jedes Mal von anderen Shorts, die zu dir passen
// (gelikte und gesehene Shorts, Shorts deiner Abos, YouTube-Vorschläge), mischt mehrere
// Abfolgen und blendet bereits Gesehenes aus. Likes und fertig geschaute Shorts werden
// während des Schauens als neue Startpunkte verwendet ("lernt mit").
import { collectItems, itemsFromFeed } from './normalize.js';

const ID = /^[\w-]{11}$/;
const TOPICS = ['shorts lustig', 'shorts tiere', 'shorts fußball', 'shorts gaming', 'shorts musik', 'shorts kochen', 'shorts fails', 'shorts life hacks', 'shorts autos', 'shorts satisfying'];

const pickRandom = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

export function sequenceIds(info) {
  return (info?.watch_next_feed || []).map((ep) => ep?.payload?.videoId).filter((v) => v && ID.test(v));
}

export class ShortsFeed {
  /**
   * @param {() => Promise<any>} getYT
   * @param {{ history?: object[], liked?: object[], subsShorts?: () => Promise<string[]>, signedIn?: boolean }} ctx
   */
  constructor(getYT, ctx = {}) {
    this.getYT = getYT;
    this.ctx = ctx;
    this.served = new Set();
    // Bereits gesehene Shorts nicht erneut zeigen.
    this.watched = new Set((ctx.history || []).filter((v) => v.short).map((v) => v.id));
    this.sequences = []; // ShortFormVideoInfo-Objekte mit weiteren Seiten
    this.usedSeeds = new Set();
  }

  get has_continuation() {
    return true;
  }

  // Startpunkte: zuerst, was dir gefallen hat, dann gesehene Shorts und Abos – immer zufällig gemischt.
  async #seedCandidates() {
    const liked = (this.ctx.liked || []).filter((v) => v.short).map((v) => v.id);
    const recent = (this.ctx.history || []).filter((v) => v.short).slice(0, 40).map((v) => v.id);
    let subs = [];
    try {
      subs = (await this.ctx.subsShorts?.()) || [];
    } catch {}
    const personal = [...pickRandom(liked, 2), ...pickRandom(recent, 2), ...pickRandom(subs, 2)];
    let fromYouTube = [];
    if (personal.length < 3 || this.ctx.signedIn) {
      // Angemeldet ist YouTubes Startseite persönlich; sonst Themen-Mix.
      const yt = await this.getYT();
      try {
        fromYouTube = itemsFromFeed(await yt.getHomeFeed(), { flatten: true }).filter((i) => i.type === 'short').map((i) => i.id);
      } catch {}
      if (fromYouTube.length < 3) {
        const topics = pickRandom(TOPICS, 2);
        const lists = await Promise.all(topics.map((t) => yt.search(t, { type: 'shorts' }).then((s) => collectItems(s.results, { flatten: true })).catch(() => [])));
        fromYouTube.push(...lists.flat().filter((i) => i.type === 'short' || i.type === 'video').map((i) => i.id));
      }
    }
    return [...new Set([...personal, ...pickRandom(fromYouTube, 4)])].filter((id) => ID.test(id) && !this.usedSeeds.has(id));
  }

  async #sequenceFrom(seed) {
    this.usedSeeds.add(seed);
    const yt = await this.getYT();
    try {
      const info = await yt.getShortsVideoInfo(seed);
      if (info.wn_has_continuation) this.sequences.push(info);
      return sequenceIds(info);
    } catch {
      return [];
    }
  }

  #take(ids) {
    const out = [];
    for (const id of ids) {
      if (this.served.has(id) || this.watched.has(id)) continue;
      this.served.add(id);
      out.push(id);
    }
    return out;
  }

  /** Nächste Shorts. `hint` = ein Short, der dir gefallen hat (Like oder fertig geschaut). */
  async next(hint) {
    const lists = [];
    if (hint && ID.test(hint) && !this.usedSeeds.has(hint)) lists.push(await this.#sequenceFrom(hint));
    if (!this.started) {
      this.started = true;
      const seeds = (await this.#seedCandidates()).slice(0, 3);
      // Die Startpunkte selbst zuerst (abwechslungsreicher Einstieg), dann ihre Abfolgen gemischt.
      const seqs = await Promise.all(seeds.map((s) => this.#sequenceFrom(s)));
      lists.push(seeds, ...seqs);
    } else if (lists.length === 0 || lists[0].length < 5) {
      // Weiter mit den gespeicherten Abfolgen (abwechselnd), sonst neue Startpunkte.
      const conts = this.sequences.splice(0, 2);
      const more = await Promise.all(conts.map(async (info) => {
        try {
          const nextInfo = await info.getWatchNextContinuation();
          if (nextInfo.wn_has_continuation) this.sequences.push(nextInfo);
          return sequenceIds(nextInfo);
        } catch {
          return [];
        }
      }));
      lists.push(...more);
      if (more.flat().length < 5) {
        const seeds = (await this.#seedCandidates()).slice(0, 2);
        lists.push(seeds, ...(await Promise.all(seeds.map((s) => this.#sequenceFrom(s)))));
      }
    }
    // Abwechselnd aus allen Listen nehmen.
    const mixed = [];
    const max = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
    return this.#take(mixed);
  }
}
