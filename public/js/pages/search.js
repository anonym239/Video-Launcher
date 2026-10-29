import { api, el, html, raw, qs } from '../util.js';
import { icon } from '../icons.js';
import { appendItems, infinite, skeletonGrid, emptyState, chipBar, closeOverlay, openDialog } from '../components.js';
import { go } from '../router.js';

const FILTERS = {
  upload_date: { title: 'Uploaddatum', options: [['all', 'Alle'], ['today', 'Heute'], ['week', 'Diese Woche'], ['month', 'Dieser Monat'], ['year', 'Dieses Jahr']] },
  type: { title: 'Typ', options: [['all', 'Alle'], ['video', 'Video'], ['shorts', 'Shorts'], ['channel', 'Kanal'], ['playlist', 'Playlist'], ['movie', 'Film']] },
  duration: { title: 'Dauer', options: [['all', 'Alle'], ['short', 'Unter 4 Minuten'], ['medium', '4–20 Minuten'], ['long', 'Über 20 Minuten']] },
  features: { title: 'Merkmale', multi: true, options: [['live', 'Live'], ['4k', '4K'], ['hd', 'HD'], ['subtitles', 'Untertitel'], ['creative_commons', 'Creative Commons'], ['360', '360°'], ['vr180', 'VR180'], ['3d', '3D'], ['hdr', 'HDR'], ['location', 'Standort']] },
  prioritize: { title: 'Sortieren nach', options: [['relevance', 'Relevanz'], ['popularity', 'Beliebtheit']] }
};

export default async function search({ node, query, signal }) {
  const q = query.get('search_query') || '';
  const params = {};
  for (const k of Object.keys(FILTERS)) if (query.get(k)) params[k] = query.get(k);

  const typeChips = [
    { label: 'Alle', value: 'all' },
    { label: 'Videos', value: 'video' },
    { label: 'Shorts', value: 'shorts' },
    { label: 'Kanäle', value: 'channel' },
    { label: 'Playlists', value: 'playlist' },
    { label: 'Zuletzt hochgeladen', value: 'recent' },
    { label: 'Live', value: 'live' }
  ];
  const activeChip = params.features === 'live' ? 'live' : params.upload_date === 'week' && !params.type ? 'recent' : params.type || 'all';

  node.innerHTML = '';
  const head = el(`<div class="search-head"></div>`);
  const filterBtn = el(html`<button class="btn btn-text filter-btn">${raw(icon('tune'))}<span>Filter</span></button>`);
  head.appendChild(chipBar(typeChips, activeChip, (v) => {
    const p = { search_query: q };
    if (v === 'recent') p.upload_date = 'week';
    else if (v === 'live') p.features = 'live';
    else if (v !== 'all') p.type = v;
    go('/results' + qs(p), { replace: true });
  }));
  head.appendChild(filterBtn);
  node.appendChild(head);
  filterBtn.onclick = () => filterDialog(q, params);

  const sk = skeletonGrid(8, 'list');
  node.appendChild(sk);
  const data = await api('/api/search' + qs({ q, ...params }), { signal });
  const list = el('<div class="list-col search-results"></div>');
  sk.replaceWith(list);
  if (data.corrected) {
    list.before(el(html`<p class="corrected">Ergebnisse für <a href="/results?search_query=${encodeURIComponent(data.corrected)}"><b><i>${data.corrected}</i></b></a></p>`));
  }
  if (!data.items.length) {
    list.appendChild(emptyState('Keine Ergebnisse gefunden', 'Versuche es mit anderen Suchbegriffen oder entferne Filter.', 'search'));
    return;
  }
  appendItems(list, data.items, 'list');
  let cont = data.cont;
  if (cont) {
    infinite(list, async () => {
      const more = await api('/api/search' + qs({ cont }), { signal });
      appendItems(list, more.items, 'list');
      cont = more.cont;
      return !!cont;
    }, { signal });
  }
}

function filterDialog(q, current) {
  const sel = { ...current, features: (current.features || '').split(',').filter(Boolean) };
  const body = el('<div class="filter-grid"></div>');
  for (const [key, f] of Object.entries(FILTERS)) {
    const col = el(html`<div class="filter-col"><h3>${f.title}</h3></div>`);
    for (const [value, label] of f.options) {
      const active = f.multi ? sel.features.includes(value) : (sel[key] || f.options[0][0]) === value;
      const b = el(html`<button class="filter-opt ${active ? 'active' : ''}">${label}${active && value !== f.options[0][0] ? raw(icon('close')) : ''}</button>`);
      b.onclick = () => {
        if (f.multi) {
          sel.features = sel.features.includes(value) ? sel.features.filter((x) => x !== value) : [...sel.features, value];
        } else {
          sel[key] = sel[key] === value ? f.options[0][0] : value;
        }
        const p = { search_query: q };
        for (const k of Object.keys(FILTERS)) {
          if (k === 'features') {
            if (sel.features.length) p.features = sel.features.join(',');
          } else if (sel[k] && sel[k] !== FILTERS[k].options[0][0]) p[k] = sel[k];
        }
        closeOverlay();
        go('/results' + qs(p), { replace: true });
      };
      col.appendChild(b);
    }
    body.appendChild(col);
  }
  openDialog({ title: 'Suchfilter', body, className: 'filter-dialog' });
}
