import { api, html } from '../util.js';
import { channelCard, emptyState } from '../components.js';

export default async function channels({ node, signal }) {
  node.innerHTML = html`<div class="narrow-page"><h1 class="page-title">Alle Abos</h1><input class="filter-input" type="search" placeholder="Abos durchsuchen"><div class="list-col channel-list"><div class="spinner"></div></div></div>`.toString();
  const list = node.querySelector('.channel-list');
  const { items } = await api('/api/subscriptions', { signal });
  list.innerHTML = '';
  if (!items.length) {
    list.appendChild(emptyState('Keine Abos', 'Abonniere Kanäle über den Button „Abonnieren“.', 'subs'));
    return;
  }
  const cards = items.map((c) => {
    const card = channelCard(c, 'list');
    card.dataset.name = (c.name || '').toLowerCase();
    list.appendChild(card);
    return card;
  });
  node.querySelector('.filter-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    for (const c of cards) c.hidden = !!q && !c.dataset.name.includes(q);
  });
}
