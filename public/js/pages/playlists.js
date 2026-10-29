import { api, el, html, raw } from '../util.js';
import { icon } from '../icons.js';
import { playlistCard, openDialog, toast } from '../components.js';
import { signedIn } from '../state.js';
import { go } from '../router.js';

export default async function playlists({ node, signal }) {
  node.innerHTML = html`<div class="playlists-page"><div class="page-head"><h1 class="page-title">Playlists</h1><button class="btn btn-tonal new-pl">${raw(icon('add'))}<span>Neue Playlist</span></button></div><div class="rich-grid"><div class="spinner"></div></div></div>`.toString();
  const grid = node.querySelector('.rich-grid');
  const lib = await api('/api/library', { signal });
  grid.innerHTML = '';
  const fixed = [
    { type: 'playlist', id: 'WL', title: 'Später ansehen', thumbnail: lib.watchLater.thumbnail, count: lib.account ? '' : `${lib.watchLater.count} Videos`, channel: { name: 'Privat' }, local: true },
    { type: 'playlist', id: 'LL', title: 'Videos mit „Mag ich“', thumbnail: lib.liked.thumbnail, count: lib.account ? '' : `${lib.liked.count} Videos`, channel: { name: 'Privat' }, local: true }
  ];
  for (const p of [...fixed, ...lib.playlists.filter((p) => p.id !== 'WL' && p.id !== 'LL'), ...lib.local]) grid.appendChild(playlistCard(p, 'grid'));

  node.querySelector('.new-pl').onclick = () => {
    const body = el(html`<form class="create-form">
      <label class="field"><span>Name</span><input name="title" maxlength="150" required></label>
      <label class="field"><span>Sichtbarkeit</span><select name="privacy"><option value="PRIVATE">Privat</option><option value="UNLISTED">Nicht gelistet</option><option value="PUBLIC">Öffentlich</option></select></label>
      ${signedIn() ? html`<label class="check-row small"><input type="checkbox" name="local"><span>Nur auf diesem Handy speichern</span></label>` : ''}
    </form>`);
    openDialog({
      title: 'Neue Playlist',
      body,
      actions: [{ label: 'Abbrechen' }, { label: 'Erstellen', primary: true, run: async () => {
        const title = body.title.value.trim();
        if (!title) return false;
        try {
          const r = await api('/api/playlists', { method: 'POST', body: { title, privacy: body.privacy.value, local: !signedIn() || body.local?.checked } });
          toast('Playlist erstellt');
          if (r.id) go(`/playlist?list=${encodeURIComponent(r.id)}`);
        } catch (e) {
          toast(e.message);
          return false;
        }
      } }]
    });
    body.title.focus();
  };
}
