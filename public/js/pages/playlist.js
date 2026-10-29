import { api, el, html, raw, qs } from '../util.js';
import { icon } from '../icons.js';
import { videoCard, infinite, emptyState, openDialog, openMenu, toast, shareDialog } from '../components.js';
import { go } from '../router.js';

export default async function playlist({ node, query, signal }) {
  const id = query.get('list');
  if (!id) {
    node.appendChild(emptyState('Keine Playlist angegeben', '', 'playlist'));
    return;
  }
  node.innerHTML = '<div class="playlist-page"><div class="spinner"></div></div>';
  const data = await api(`/api/playlist/${encodeURIComponent(id)}`, { signal });
  const info = data.info;
  document.title = `${info.title} - Video Launcher`;
  const page = node.querySelector('.playlist-page');
  const first = data.items.find((v) => v.type === 'video');
  page.innerHTML = '';
  const header = el(html`<aside class="pl-header" style="--pl-bg:url('${info.thumbnail || ''}')">
    <div class="pl-header-inner">
      <div class="pl-cover">${info.thumbnail ? html`<img src="${info.thumbnail}" alt="">` : raw(`<div class="thumb-empty">${icon('playlist')}</div>`)}</div>
      <h1 class="pl-title">${info.title}</h1>
      ${info.author?.name ? html`<div class="pl-author">${info.author.id ? html`<a href="/channel/${info.author.id}">${info.author.name}</a>` : info.author.name}</div>` : ''}
      <div class="pl-meta">${[info.privacy === 'PRIVATE' ? 'Privat' : info.privacy === 'UNLISTED' ? 'Nicht gelistet' : '', info.count, info.views, info.updated].filter(Boolean).join(' • ')}</div>
      ${info.description ? html`<p class="pl-desc">${info.description}</p>` : ''}
      <div class="pl-actions">
        <button class="btn btn-light pl-play">${raw(icon('play'))}<span>Alle wiedergeben</span></button>
        <button class="btn btn-tonal-dark pl-shuffle">${raw(icon('shuffle'))}<span>Zufallsmix</span></button>
        <button class="icon-btn btn-tonal-dark round pl-more" aria-label="Mehr">${raw(icon('moreH'))}</button>
      </div>
    </div>
  </aside>`);
  const list = el('<div class="pl-list"></div>');
  page.append(header, list);

  const playAt = (v, shuffle = false) => {
    if (!v) return;
    localStorage.setItem('vl:plShuffle', shuffle ? '1' : '0');
    go(`/watch?v=${v.id}&list=${encodeURIComponent(id)}`);
  };
  header.querySelector('.pl-play').onclick = () => playAt(first);
  header.querySelector('.pl-shuffle').onclick = () => {
    const vids = data.items.filter((v) => v.type === 'video');
    playAt(vids[Math.floor(Math.random() * vids.length)], true);
  };
  header.querySelector('.pl-more').onclick = (e) => {
    const items = [{ icon: 'share', label: 'Teilen', run: () => shareDialog({ id: first?.id || '', title: info.title }) }];
    if (info.editable && !['WL', 'LL'].includes(id)) {
      items.push({ icon: 'edit', label: 'Umbenennen', run: () => renameDialog(id, info.title) });
      items.push({ icon: 'delete', label: 'Playlist löschen', danger: true, run: () => deleteDialog(id, info.title) });
    }
    openMenu(e.currentTarget, items);
  };
  if (info.local || id.startsWith('LP') || (['WL', 'LL'].includes(id) && info.local)) {
    // Lokale Listen funktionieren nicht als YouTube-Playlist im Player → einzelne Videos öffnen.
    header.querySelector('.pl-play').onclick = () => first && go(`/watch?v=${first.id}`);
    header.querySelector('.pl-shuffle').hidden = true;
  }

  if (!data.items.length) {
    list.appendChild(emptyState('Diese Playlist enthält keine Videos.', '', 'playlist'));
    return;
  }
  let n = 0;
  const add = (items) => {
    for (const v of items) {
      if (v.type !== 'video' && v.type !== 'short') continue;
      n++;
      const row = el(html`<div class="pl-item"><span class="pl-num">${v.index || n}</span></div>`);
      const card = videoCard({ ...v, listId: info.local ? null : id, index: n }, 'list');
      row.appendChild(card);
      if (info.editable) {
        const rm = el(html`<button class="icon-btn pl-remove" aria-label="Entfernen">${raw(icon('delete'))}</button>`);
        rm.onclick = async () => {
          try {
            await api('/api/save', { method: 'POST', body: { video: v, playlistId: id, on: false } });
            row.remove();
            toast('Aus Playlist entfernt');
          } catch (e) {
            toast(e.message);
          }
        };
        row.appendChild(rm);
      }
      list.appendChild(row);
    }
  };
  add(data.items);
  let cont = data.cont;
  if (cont) {
    infinite(list, async () => {
      const more = await api(`/api/playlist/${encodeURIComponent(id)}` + qs({ cont }), { signal });
      add(more.items);
      cont = more.cont;
      return !!cont;
    }, { signal });
  }
}

function renameDialog(id, title) {
  const body = el(html`<label class="field"><span>Name</span><input value="${title}" maxlength="150"></label>`);
  openDialog({
    title: 'Playlist umbenennen',
    body,
    actions: [
      { label: 'Abbrechen' },
      { label: 'Speichern', primary: true, run: async () => {
        try {
          await api(`/api/playlists/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title: body.querySelector('input').value } });
          toast('Gespeichert');
          go(location.pathname + location.search, { replace: true });
        } catch (e) {
          toast(e.message);
          return false;
        }
      } }
    ]
  });
}

function deleteDialog(id, title) {
  openDialog({
    title: 'Playlist löschen',
    body: html`<p>„${title}“ wird endgültig gelöscht.</p>`,
    actions: [
      { label: 'Abbrechen' },
      { label: 'Löschen', primary: true, run: async () => {
        try {
          await api(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
          toast('Playlist gelöscht');
          go('/feed/playlists');
        } catch (e) {
          toast(e.message);
          return false;
        }
      } }
    ]
  });
}
