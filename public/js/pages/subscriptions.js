import { api, el, html, raw, qs, relativeTime } from '../util.js';
import { icon } from '../icons.js';
import { appendItems, infinite, skeletonGrid, emptyState, avatar } from '../components.js';
import { state, signedIn } from '../state.js';

export default async function subscriptions({ node, signal }) {
  node.innerHTML = html`<div class="subs-page">
    <div class="subs-channels"></div>
    <div class="page-head"><h2>Neueste</h2><a class="btn btn-text" href="/feed/channels">Verwalten</a></div>
  </div>`.toString();
  const page = node.querySelector('.subs-page');
  const sk = skeletonGrid(12);
  page.appendChild(sk);

  // Kanal-Leiste oben (wie in der App)
  api('/api/subscriptions', { signal }).then(({ items }) => {
    const row = node.querySelector('.subs-channels');
    for (const c of items.slice(0, 30)) {
      row.appendChild(el(html`<a class="subs-chip" href="/channel/${c.id}">${avatar(c.avatar, 56, c.name)}<span>${c.name}</span></a>`));
    }
  }).catch(() => {});

  const data = await api('/api/feed/subscriptions', { signal });
  const grid = el('<div class="rich-grid"></div>');
  sk.replaceWith(grid);
  if (data.local) {
    // RSS liefert absolute Zeitpunkte → relativ anzeigen.
    for (const v of data.items) v.published = relativeTime(v.publishedAt);
    if (!signedIn()) {
      grid.before(el(html`<p class="hint">${raw(icon('info'))} Abos werden auf deinem Handy gespeichert. <button class="link-btn login-hint">Anmelden</button>, um deine YouTube-Abos zu verwenden.</p>`));
      node.querySelector('.login-hint').onclick = () => import('../app.js').then((m) => m.loginDialog());
    }
  }
  if (!data.items.length) {
    grid.replaceWith(emptyState('Keine neuen Videos', state.subs.size ? 'Deine Kanäle haben in letzter Zeit nichts hochgeladen.' : 'Abonniere Kanäle, um ihre neuesten Videos hier zu sehen.', 'subs'));
    return;
  }
  appendItems(grid, data.items, 'grid');
  let cont = data.cont;
  if (cont) {
    infinite(grid, async () => {
      const more = await api('/api/feed/subscriptions' + qs({ cont }), { signal });
      appendItems(grid, more.items, 'grid');
      cont = more.cont;
      return !!cont;
    }, { signal });
  }
}
