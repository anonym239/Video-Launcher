// „Mein YouTube“ (Du-Seite) – aufgebaut wie in der YouTube-App:
// Profil, Schnellwahl-Chips, Verlauf, Playlists und eine Liste weiterer Bereiche.
import { api, el, html, raw } from '../util.js';
import { icon } from '../icons.js';
import { videoCard, shortCard, playlistCard, avatar, openDialog, toast } from '../components.js';
import { state, signedIn } from '../state.js';
import { loginDialog, themeMenu } from '../app.js';

const G = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 3.9-5.35 3.9a5.9 5.9 0 1 1 0-11.8c1.45 0 2.75.5 3.8 1.4l2.15-2.15A8.9 8.9 0 0 0 12 3a9 9 0 1 0 0 18c4.5 0 8.6-3.25 8.6-9 0-.3-.1-.6-.25-.9z"/></svg>';

export default async function you({ node, signal }) {
  const acc = state.auth.account || {};
  const chan = acc.channelId ? `/channel/${acc.channelId}` : '';
  const incognito = !!state.settings.historyPaused;
  node.innerHTML = html`<div class="you-page">
    <div class="you-head">
      ${signedIn()
        ? html`<a class="you-avatar" href="${chan || '/settings'}">${avatar(acc.photo, 80, acc.name || 'G')}</a>
           <div class="you-id"><h1>${acc.name || 'Google-Konto'}</h1>
           <div class="you-sub">${acc.handle ? html`<span>${acc.handle}</span><span class="dot">•</span>` : ''}${chan ? html`<a href="${chan}">Zum Kanal ${raw(icon('right'))}</a>` : ''}</div></div>`
        : html`${raw(icon('account', 'you-guest'))}<div><h1>Nicht angemeldet</h1><button class="btn btn-blue you-login">Anmelden</button></div>`}
    </div>
    <div class="you-chips">
      <button class="chip you-switch">${raw(icon('switchAccount'))}<span>Konto wechseln</span></button>
      <a class="chip" href="https://myaccount.google.com/" target="_blank" rel="noopener">${raw(G)}<span>Google-Konto</span></a>
      <button class="chip you-incognito ${incognito ? 'active' : ''}">${raw(icon('incognito'))}<span>Inkognito</span></button>
      <button class="chip you-theme">${raw(icon('theme'))}<span>Design</span></button>
    </div>
    <section class="you-section">
      <div class="you-section-head"><a href="/feed/history"><h2>Verlauf</h2>${raw(icon('right'))}</a></div>
      <div class="h-scroll you-history"><div class="spinner"></div></div>
    </section>
    <section class="you-section">
      <div class="you-section-head"><a href="/feed/playlists"><h2>Playlists</h2>${raw(icon('right'))}</a><a class="icon-btn" href="/feed/playlists" aria-label="Playlist erstellen">${raw(icon('add'))}</a></div>
      <div class="h-scroll you-playlists"></div>
    </section>
    <nav class="you-list">
      ${chan ? html`<a class="you-row" href="${chan}/videos">${raw(icon('myVideos'))}<span>Meine Videos</span></a>` : ''}
      <a class="you-row" href="/feed/downloads">${raw(icon('download'))}<span>Downloads<small class="muted you-dl-count"></small></span></a>
      <a class="you-row" href="/playlist?list=WL">${raw(icon('clock'))}<span>Später ansehen</span></a>
      <a class="you-row" href="/playlist?list=LL">${raw(icon('like'))}<span>Videos mit „Mag ich“</span></a>
      <a class="you-row" href="/settings">${raw(icon('settings'))}<span>Einstellungen</span></a>
    </nav>
  </div>`.toString();

  node.querySelector('.you-login')?.addEventListener('click', loginDialog);
  node.querySelector('.you-theme').onclick = (e) => themeMenu(e.currentTarget);
  node.querySelector('.you-switch').onclick = () =>
    openDialog({
      title: 'Konto wechseln',
      body: html`<p>Du wirst abgemeldet und kannst dich danach mit einem anderen Google-Konto anmelden.</p>`,
      actions: [
        { label: 'Abbrechen' },
        {
          label: 'Weiter',
          primary: true,
          run: async () => {
            const { setAuth } = await import('../state.js');
            setAuth(await api('/api/auth/logout', { method: 'POST' }));
          }
        }
      ]
    });
  const inc = node.querySelector('.you-incognito');
  inc.onclick = async () => {
    const on = !inc.classList.contains('active');
    try {
      const r = await api('/api/history/pause', { method: 'POST', body: { paused: on } });
      state.settings.historyPaused = r.paused ?? on;
      inc.classList.toggle('active', on);
      toast(on ? 'Inkognito an – der Verlauf wird nicht gespeichert' : 'Inkognito aus');
    } catch (e) {
      toast(e.message);
    }
  };

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
    node.querySelector('.you-history').innerHTML = '<p class="muted">Ohne Internet nicht verfügbar.</p>';
    return;
  }
  const hist = node.querySelector('.you-history');
  hist.innerHTML = '';
  if (!lib.history.length) hist.appendChild(el('<p class="muted">Videos, die du dir ansiehst, werden hier angezeigt.</p>'));
  for (const v of lib.history) hist.appendChild(v.type === 'short' ? shortCard(v, 'shelf') : videoCard(v, 'grid'));

  const pls = node.querySelector('.you-playlists');
  const fixed = [
    { type: 'playlist', id: 'LL', title: 'Videos, die ich mag', thumbnail: lib.liked.thumbnail, count: lib.account ? '' : `${lib.liked.count} Videos`, channel: { name: 'Privat' }, local: true },
    { type: 'playlist', id: 'WL', title: 'Später ansehen', thumbnail: lib.watchLater.thumbnail, count: lib.account ? '' : `${lib.watchLater.count} Videos`, channel: { name: 'Privat' }, local: true }
  ];
  for (const p of [...fixed, ...lib.playlists, ...lib.local]) pls.appendChild(playlistCard(p, 'grid'));
}
