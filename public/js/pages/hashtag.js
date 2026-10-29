import { api, el, html, qs } from '../util.js';
import { appendItems, infinite, skeletonGrid, emptyState } from '../components.js';

export default async function hashtag({ node, params, signal }) {
  const tag = params.tag.replace(/^#/, '');
  node.innerHTML = '';
  const sk = skeletonGrid(12);
  node.appendChild(sk);
  const data = await api(`/api/hashtag/${encodeURIComponent(tag)}`, { signal });
  const head = el(html`<div class="hashtag-head"><h1>${data.title || '#' + tag}</h1><p class="muted">${data.subtitle || ''}</p></div>`);
  const grid = el('<div class="rich-grid"></div>');
  sk.replaceWith(head);
  head.after(grid);
  if (!data.items.length) {
    grid.replaceWith(emptyState('Keine Videos mit diesem Hashtag', '', 'search'));
    return;
  }
  appendItems(grid, data.items, 'grid');
  let cont = data.cont;
  if (cont) {
    infinite(grid, async () => {
      const more = await api(`/api/hashtag/${encodeURIComponent(tag)}` + qs({ cont }), { signal });
      appendItems(grid, more.items, 'grid');
      cont = more.cont;
      return !!cont;
    }, { signal });
  }
}
