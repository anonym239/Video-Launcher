// Trends / Entdecken: Kategorien über die Suche (YouTube hat die Trends-Seite abgeschafft).
import { api, el, qs } from '../util.js';
import { appendItems, chipBar, skeletonGrid, infinite } from '../components.js';

const CATS = [
  { label: 'Jetzt', value: 'Trends' },
  { label: 'Musik', value: 'Musik neu' },
  { label: 'Gaming', value: 'Gaming' },
  { label: 'Filme', value: 'Trailer' },
  { label: 'Nachrichten', value: 'Nachrichten' },
  { label: 'Sport', value: 'Sport Highlights' },
  { label: 'Podcasts', value: 'Podcast' }
];

export default async function explore({ node, signal }) {
  node.innerHTML = '<div class="explore-page"><h1 class="page-title">Trends</h1></div>';
  const page = node.querySelector('.explore-page');
  let list = el('<div class="list-col"></div>');
  let scroller = null;
  page.appendChild(chipBar(CATS, CATS[0].value, (v) => load(v)));
  page.appendChild(list);

  async function load(q) {
    scroller?.stop();
    const sk = skeletonGrid(8, 'list');
    list.replaceWith(sk);
    list = el('<div class="list-col"></div>');
    const data = await api('/api/search' + qs({ q, type: 'video', upload_date: 'week', prioritize: 'popularity' }), { signal });
    sk.replaceWith(list);
    appendItems(list, data.items, 'list');
    let cont = data.cont;
    if (cont) {
      scroller = infinite(list, async () => {
        const more = await api('/api/search' + qs({ cont }), { signal });
        appendItems(list, more.items, 'list');
        cont = more.cont;
        return !!cont;
      }, { signal });
    }
  }
  await load(CATS[0].value);
}
