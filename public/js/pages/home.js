import { api, el, qs } from '../util.js';
import { appendItems, infinite, skeletonGrid, chipBar, emptyState } from '../components.js';

export default async function home({ node, signal }) {
  node.innerHTML = '<div class="home-chips"></div><div class="rich-grid"></div>';
  const chipsBox = node.querySelector('.home-chips');
  let grid = node.querySelector('.rich-grid');
  let scroller = null;

  async function load(chip) {
    scroller?.stop();
    const sk = skeletonGrid(12);
    grid.replaceWith(sk);
    grid = el('<div class="rich-grid"></div>');
    let data;
    try {
      data = await api('/api/home' + qs({ chip }), { signal });
    } catch (e) {
      sk.replaceWith(grid);
      throw e;
    }
    sk.replaceWith(grid);
    if (!chipsBox.childElementCount && data.chips?.length) {
      chipsBox.appendChild(chipBar(data.chips, data.chips[0], (c) => load(c).catch(() => {})));
    }
    if (!data.items.length) {
      grid.appendChild(emptyState('Hier ist noch nichts', 'Suche nach Videos oder sieh dir ein paar an – dann werden Empfehlungen angezeigt.', 'search'));
      return;
    }
    appendItems(grid, data.items, 'grid');
    let cont = data.cont;
    const kind = data.contKind === 'search' ? '/api/search' : '/api/home';
    if (cont) {
      scroller = infinite(grid, async () => {
        const more = await api(kind + qs({ cont }), { signal });
        appendItems(grid, more.items, 'grid');
        cont = more.cont;
        return !!cont;
      }, { signal });
    }
  }

  await load(null);
}
