// "Du"-Seite (Bibliothek): Verlauf, Playlists, Später ansehen, Mag ich.
import { api, el, html, raw } from '../util.js';
import { icon } from '../icons.js';
import { videoCard, shortCard, playlistCard, avatar } from '../components.js';
import { state, signedIn } from '../state.js';
import { loginDialog, themeMenu } from '../app.js';

export default async function you({ node, signal }) {
  const acc = state.auth.account;
  node.innerHTML = html`<div class="you-page">
    <div class="you-head">
      ${signedIn()
        ? html`${avatar(acc?.photo, 72, acc?.name || 'G')}<div><h1>${acc?.name || 'Google-Konto'}</h1><div class="muted">${acc?.handle || ''}${acc?.channelId ? html` • <a href="/channel/${acc.channelId}">Kanal ansehen</a>` : ''}</div></div>`
        : html`${raw(icon('account', 'you-guest'))}<div><h1>Du bist nicht angemeldet</h1><p class="muted">Abos, Verlauf und Playlists werden lokal auf deinem Handy gespeichert.</p><button class="btn btn-blue you-login">Anmelden</button></div>`}
    </div>
    <div class="you-quick">
      <button class="btn btn-tonal you-theme">${raw(icon('theme'))}<span>Design</span></button>
      <a class="btn btn-tonal" href="/settings">${raw(icon('settings'))}<span>Einstellungen</span></a>
    </div>
    <a class="you-row" href="/feed/downloads">${raw(icon('download'))}<span><b>Downloads</b><small class="muted you-dl-count">Auch ohne Internet ansehen</small></span>${raw(icon('right'))}</a>
    <section class="you-section"><div class="you-section-head"><h2>Verlauf</h2><a class="btn btn-outline small" href="/feed/history">Alle ansehen</a></div><div class="h-scroll you-history"><div class="spinner"></div></div></section>
    <section class="you-section"><div class="you-section-head"><h2>Playlists</h2><a class="btn btn-outline small" href="/feed/playlists">Alle ansehen</a></div><div class="h-scroll you-playlists"></div></section>
  </div>`.toString();
  node.querySelector('.you-login')?.addEventListener('click', loginDialog);
  node.querySelector('.you-theme').onclick = (e) => themeMenu(e.currentTarget);

  api('/api/offline', { signal })
    .then((d) => {
      const n = d.items.length;
      if (n) node.querySelector('.you-dl-count').textContent = `${n} ${n === 1 ? 'Video' : 'Videos'} · auch ohne Internet`;
    })
    .catch(() => {});

  let lib;
  try {
    lib = await api('/api/library', { signal });
  } catch {
    // Offline: Rest der Seite leer lassen, Downloads bleiben erreichbar.
    node.querySelector('.you-history').innerHTML = '<p class="muted">Ohne Internet nicht verfügbar.</p>';
    return;
  }
  const hist = node.querySelector('.you-history');
  hist.innerHTML = '';
  if (!lib.history.length) hist.appendChild(el('<p class="muted">Videos, die du dir ansiehst, werden hier angezeigt.</p>'));
  for (const v of lib.history) hist.appendChild(v.type === 'short' ? shortCard(v, 'shelf') : videoCard(v, 'grid'));

  const pls = node.querySelector('.you-playlists');
  const fixed = [
    { type: 'playlist', id: 'WL', title: 'Später ansehen', thumbnail: lib.watchLater.thumbnail, count: lib.account ? '' : `${lib.watchLater.count} Videos`, channel: { name: lib.account ? 'Google-Konto' : 'Lokal' }, local: true },
    { type: 'playlist', id: 'LL', title: 'Videos mit „Mag ich“', thumbnail: lib.liked.thumbnail, count: lib.account ? '' : `${lib.liked.count} Videos`, channel: { name: lib.account ? 'Google-Konto' : 'Lokal' }, local: true }
  ];
  for (const p of [...fixed, ...lib.playlists, ...lib.local]) pls.appendChild(playlistCard(p, 'grid'));
}
