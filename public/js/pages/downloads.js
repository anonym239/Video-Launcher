// Downloads: Videos und Shorts im App-Speicher – funktioniert auch ohne Internet.
import { api, el, html, raw } from '../util.js';
import { icon } from '../icons.js';
import { emptyState, openMenu, openDialog, toast } from '../components.js';
import { go } from '../router.js';

const size = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

export default async function downloads({ node, signal }) {
  node.innerHTML = html`<div class="downloads-page">
    <h1 class="page-title">Downloads</h1>
    <div class="dl-offline-hint" hidden>${raw(icon('info'))}<span>Du bist offline. Deine heruntergeladenen Videos kannst du trotzdem ansehen.</span></div>
    <div class="dl-jobs"></div>
    <section class="dl-shorts-section" hidden><h2 class="dl-sub">${raw(icon('shortsLogo', 'shorts-red'))} Shorts</h2><div class="dl-shorts"></div></section>
    <section class="dl-videos-section"><h2 class="dl-sub dl-videos-title" hidden>Videos</h2><div class="dl-videos list-col"></div></section>
  </div>`.toString();

  api('/api/online', { signal })
    .then((r) => (node.querySelector('.dl-offline-hint').hidden = r.online))
    .catch(() => {});

  let timer = null;
  signal?.addEventListener('abort', () => clearTimeout(timer));

  async function load() {
    const data = await api('/api/offline', { signal });
    renderJobs(data.jobs);
    renderItems(data.items);
    // Laufende Downloads: Fortschritt aktualisieren.
    if (data.jobs.some((j) => !j.error)) timer = setTimeout(() => load().catch(() => {}), 1000);
  }

  function renderJobs(jobs) {
    const box = node.querySelector('.dl-jobs');
    box.innerHTML = '';
    for (const j of jobs) {
      const pct = j.total ? Math.min(100, Math.round((j.bytes / j.total) * 100)) : 0;
      const row = el(html`<div class="dl-job ${j.error ? 'error' : ''}">
        <div class="dl-job-text"><b>${j.title || j.id}</b><small class="muted">${j.error ? `Fehler: ${j.error}` : `${j.label ? j.label + ' · ' : ''}${j.total ? `${pct} % · ${size(j.bytes)} von ${size(j.total)}` : size(j.bytes)}`}</small>
        <div class="dl-bar"><div style="width:${j.error ? 100 : pct}%"></div></div></div>
        <button class="icon-btn" aria-label="Abbrechen">${raw(icon('close'))}</button>
      </div>`);
      row.querySelector('button').onclick = async () => {
        await api(`/api/offline/${j.id}`, { method: 'DELETE' }).catch(() => {});
        load().catch(() => {});
      };
      box.appendChild(row);
    }
  }

  function menu(item, anchor) {
    openMenu(anchor, [
      { icon: 'play', label: 'Abspielen', run: () => go(item.short ? `/shorts/${item.id}` : `/watch?v=${item.id}`) },
      {
        icon: 'delete',
        label: 'Aus Downloads löschen',
        run: () =>
          openDialog({
            title: 'Download löschen?',
            body: html`<p>„${item.title}“ wird vom Handy entfernt.</p>`,
            actions: [
              { label: 'Abbrechen' },
              {
                label: 'Löschen',
                primary: true,
                run: async () => {
                  await api(`/api/offline/${item.id}`, { method: 'DELETE' });
                  toast('Download gelöscht');
                  load().catch(() => {});
                }
              }
            ]
          })
      }
    ]);
  }

  function renderItems(items) {
    const shorts = items.filter((i) => i.short);
    const videos = items.filter((i) => !i.short);
    const sBox = node.querySelector('.dl-shorts');
    const vBox = node.querySelector('.dl-videos');
    node.querySelector('.dl-shorts-section').hidden = !shorts.length;
    node.querySelector('.dl-videos-title').hidden = !shorts.length || !videos.length;
    sBox.innerHTML = '';
    vBox.innerHTML = '';
    for (const s of shorts) {
      const c = el(html`<div class="dl-short">
        <a href="/shorts/${s.id}" class="dl-short-thumb">${s.thumbnail ? html`<img src="${s.thumbnail}" alt="">` : raw(icon('shortsFilled'))}</a>
        <div class="dl-short-title"><a href="/shorts/${s.id}">${s.title}</a></div>
        <button class="icon-btn small dl-more" aria-label="Aktionsmenü">${raw(icon('more'))}</button>
      </div>`);
      c.querySelector('.dl-more').onclick = (e) => menu(s, e.currentTarget);
      sBox.appendChild(c);
    }
    for (const v of videos) {
      const row = el(html`<div class="dl-row-item">
        <a class="dl-thumb" href="/watch?v=${v.id}">${v.thumbnail ? html`<img src="${v.thumbnail}" alt="">` : raw(icon(v.audioOnly ? 'music' : 'play'))}${v.durationText ? html`<span class="thumb-badge">${v.durationText}</span>` : ''}</a>
        <div class="dl-text">
          <a class="dl-title" href="/watch?v=${v.id}">${v.title}</a>
          <div class="muted small">${v.channel.name}</div>
          <div class="muted small">${[v.audioOnly ? 'Nur Audio' : v.label, v.size ? size(v.size) : ''].filter(Boolean).join(' · ')}</div>
        </div>
        <button class="icon-btn dl-more" aria-label="Aktionsmenü">${raw(icon('more'))}</button>
      </div>`);
      row.querySelector('.dl-more').onclick = (e) => menu(v, e.currentTarget);
      vBox.appendChild(row);
    }
    if (!items.length && !node.querySelector('.dl-job')) {
      vBox.appendChild(emptyState('Noch keine Downloads', 'Tippe bei einem Video oder Short auf „Herunterladen“. Heruntergeladene Videos kannst du auch ohne Internet ansehen.', 'download'));
    }
  }

  await load();
}
