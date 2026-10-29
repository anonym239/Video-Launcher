import { api, el, html, qs } from '../util.js';
import { avatar, infinite, emptyState } from '../components.js';
import { signedIn } from '../state.js';

export default async function notifications({ node, signal }) {
  node.innerHTML = '<div class="narrow-page"><h1 class="page-title">Benachrichtigungen</h1><div class="notif-list"><div class="spinner"></div></div></div>';
  const list = node.querySelector('.notif-list');
  if (!signedIn()) {
    list.innerHTML = '';
    list.appendChild(emptyState('Melde dich an, um Benachrichtigungen zu sehen.', '', 'bell'));
    return;
  }
  const data = await api('/api/notifications', { signal });
  list.innerHTML = '';
  const add = (items) => {
    for (const n of items) {
      list.appendChild(el(html`<a class="notif ${n.read ? '' : 'unread'}" href="${n.url || '#'}">
        <span class="notif-dot"></span>${avatar(n.avatar, 48)}
        <span class="notif-text"><span>${n.text}</span><small class="muted">${n.time}</small></span>
        ${n.thumbnail ? html`<img class="notif-thumb" src="${n.thumbnail}" alt="" loading="lazy">` : ''}
      </a>`));
    }
  };
  if (!data.items.length) {
    list.appendChild(emptyState('Keine Benachrichtigungen', '', 'bell'));
    return;
  }
  add(data.items);
  let cont = data.cont;
  if (cont) {
    infinite(list, async () => {
      const more = await api('/api/notifications' + qs({ cont }), { signal });
      add(more.items);
      cont = more.items.length ? more.cont : null;
      return !!cont;
    }, { signal });
  }
}
