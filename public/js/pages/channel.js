import { api, el, html, raw, qs } from '../util.js';
import { icon } from '../icons.js';
import { appendItems, infinite, skeletonGrid, avatar, subscribeButton, chipBar, emptyState, openDialog, toast } from '../components.js';
import { go } from '../router.js';

const TAB_LABELS = { home: 'Startseite', videos: 'Videos', shorts: 'Shorts', streams: 'Live', podcasts: 'Podcasts', releases: 'Releases', playlists: 'Playlists', posts: 'Beiträge' };

export default async function channel({ node, query, signal }) {
  // Pfad: /channel/UC…[/tab] oder /@handle[/tab]
  const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const ref = parts[0] === 'channel' ? parts[1] : parts[0];
  const tab = (parts[0] === 'channel' ? parts[2] : parts[1]) || 'home';
  const base = parts[0] === 'channel' ? `/channel/${ref}` : `/${ref}`;
  const sort = query.get('sort') || '';
  const searchQ = query.get('query') || '';

  node.innerHTML = '<div class="channel-page"><div class="channel-header-slot"></div><div class="channel-body"></div></div>';
  const body = node.querySelector('.channel-body');
  body.appendChild(skeletonGrid(12));

  let data;
  if (tab === 'search' && searchQ) {
    const [head, res] = await Promise.all([
      api(`/api/channel/${encodeURIComponent(ref)}` + qs({ tab: 'about' }), { signal }),
      api(`/api/channel/${encodeURIComponent(ref)}/search` + qs({ q: searchQ }), { signal })
    ]);
    data = { ...res, channel: head.channel };
  } else {
    data = await api(`/api/channel/${encodeURIComponent(ref)}` + qs({ tab, sort }), { signal });
  }
  const ch = data.channel;
  document.title = `${ch.name} - Video Launcher`;
  renderHeader(node.querySelector('.channel-header-slot'), ch, tab, base, ref);

  body.innerHTML = '';
  if (data.error) {
    body.appendChild(emptyState(data.error, '', 'info'));
    return;
  }
  if (data.filters?.length > 1) {
    body.appendChild(chipBar(data.filters, sort || data.filters[0], (f) => go(`${base}/${tab}` + qs({ sort: f }), { replace: true })));
  }
  const grid = el(`<div class="${tab === 'posts' ? 'list-col posts-col' : tab === 'shorts' ? 'shorts-grid' : 'rich-grid'} channel-grid"></div>`);
  body.appendChild(grid);
  if (!data.items.length) {
    grid.appendChild(emptyState('Dieser Kanal hat hier keine Inhalte.', '', 'library'));
    return;
  }
  const variant = tab === 'posts' ? 'list' : 'grid';
  appendItems(grid, data.items, variant);
  let cont = data.cont;
  if (cont) {
    infinite(grid, async () => {
      const more = await api(`/api/channel/${encodeURIComponent(ref)}` + qs({ cont }), { signal });
      appendItems(grid, more.items, variant);
      cont = more.cont;
      return !!cont;
    }, { signal });
  }
}

function renderHeader(slot, ch, tab, base, ref) {
  const header = el(html`<div class="channel-header">
    ${ch.banner ? html`<div class="ch-banner"><img src="${ch.banner}" alt=""></div>` : ''}
    <div class="ch-info">
      <div class="ch-avatar">${avatar(ch.avatar, 160, ch.name)}</div>
      <div class="ch-text">
        <h1 class="ch-name">${ch.name}${ch.verified ? raw(`<span class="verified">${icon('verified')}</span>`) : ''}</h1>
        <div class="ch-meta">${[ch.handle, ch.subscribers, ch.videos].filter(Boolean).join(' • ')}</div>
        ${ch.description ? html`<button class="ch-desc"><span>${ch.description.split('\n')[0]}</span>${raw(icon('right'))}</button>` : html`<button class="ch-desc"><span>Mehr über diesen Kanal</span>${raw(icon('right'))}</button>`}
        <div class="ch-actions"></div>
      </div>
    </div>
    <nav class="ch-tabs" role="tablist">
      ${ch.tabs.filter((t) => TAB_LABELS[t]).map((t) => html`<a class="ch-tab ${t === tab ? 'active' : ''}" href="${base}${t === 'home' ? '' : '/' + t}" role="tab">${TAB_LABELS[t]}</a>`)}
      <form class="ch-search">${raw(`<button type="button" class="icon-btn ch-search-btn" aria-label="Kanal durchsuchen">${icon('search')}</button>`)}<input name="q" placeholder="Suchen" hidden></form>
    </nav>
  </div>`);
  header.querySelector('.ch-actions').appendChild(subscribeButton({ id: ch.id, name: ch.name, avatar: ch.avatar }, ch.subscribed));
  if (ch.rss) {
    const rss = el(`<a class="btn btn-tonal" href="${ch.rss}" target="_blank" rel="noopener">RSS</a>`);
    header.querySelector('.ch-actions').appendChild(rss);
  }
  header.querySelector('.ch-desc').onclick = () => aboutDialog(ref, ch);
  const form = header.querySelector('.ch-search');
  const input = form.querySelector('input');
  form.querySelector('.ch-search-btn').onclick = () => {
    if (input.hidden) {
      input.hidden = false;
      input.focus();
    } else if (input.value.trim()) form.requestSubmit();
    else input.hidden = true;
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    if (input.value.trim()) go(`${base}/search?query=${encodeURIComponent(input.value.trim())}`);
  };
  slot.replaceWith(header);
}

async function aboutDialog(ref, ch) {
  const body = el('<div class="about"><div class="spinner"></div></div>');
  openDialog({ title: 'Kanalinfo', body, className: 'about-dialog' });
  try {
    const { about } = await api(`/api/channel/${encodeURIComponent(ref)}` + qs({ tab: 'about' }));
    body.innerHTML = html`
      <h3>Beschreibung</h3>
      <div class="about-desc">${raw(about.descriptionHtml || '')}</div>
      ${about.links.length ? html`<h3>Links</h3><div class="about-links">${about.links.map((l) => html`<a href="${l.url}" target="_blank" rel="noopener noreferrer">${l.favicon ? html`<img src="${l.favicon}" alt="">` : raw(icon('link'))}<span><b>${l.title}</b><small>${l.url.replace(/^https?:\/\//, '')}</small></span></a>`)}</div>` : ''}
      <h3>Kanaldetails</h3>
      <ul class="about-details">
        <li>${raw(icon('globe'))}<a href="https://www.youtube.com/${ch.handle || 'channel/' + ch.id}" target="_blank" rel="noopener">youtube.com/${ch.handle || 'channel/' + ch.id}</a></li>
        ${about.subscribers ? html`<li>${raw(icon('account'))}${about.subscribers}</li>` : ''}
        ${about.videos ? html`<li>${raw(icon('playlist'))}${about.videos}</li>` : ''}
        ${about.views ? html`<li>${raw(icon('trending'))}${about.views}</li>` : ''}
        ${about.joined ? html`<li>${raw(icon('info'))}${about.joined}</li>` : ''}
        ${about.country ? html`<li>${raw(icon('globe'))}${about.country}</li>` : ''}
      </ul>`.toString();
  } catch (e) {
    body.textContent = e.message;
    toast(e.message);
  }
}
