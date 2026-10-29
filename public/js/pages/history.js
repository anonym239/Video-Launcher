import { api, el, html, raw, qs, debounce } from '../util.js';
import { icon } from '../icons.js';
import { videoCard, infinite, emptyState, openDialog, toast } from '../components.js';
import { state, signedIn } from '../state.js';

export default async function history({ node, query, signal }) {
  const q = query.get('q') || '';
  node.innerHTML = html`<div class="history-page">
    <div class="history-main"><h1 class="page-title">Verlauf</h1><div class="history-list list-col"><div class="spinner"></div></div></div>
    <aside class="history-side">
      <label class="history-search">${raw(icon('search'))}<input type="search" placeholder="Verlauf durchsuchen" value="${q}"></label>
      <button class="btn btn-text h-clear">${raw(icon('delete'))}<span>Gesamten Wiedergabeverlauf löschen</span></button>
      <button class="btn btn-text h-pause">${raw(icon('pause'))}<span>Wiedergabeverlauf pausieren</span></button>
      ${signedIn() ? html`<label class="check-row small"><input type="checkbox" class="h-local"><span>Nur lokalen Verlauf anzeigen</span></label>` : ''}
    </aside>
  </div>`.toString();
  const list = node.querySelector('.history-list');
  const pauseBtn = node.querySelector('.h-pause');
  const paintPause = () => {
    const p = state.settings.historyPaused;
    pauseBtn.innerHTML = `${icon(p ? 'play' : 'pause')}<span>Wiedergabeverlauf ${p ? 'fortsetzen' : 'pausieren'}</span>`;
  };
  paintPause();

  async function load(search, local) {
    list.innerHTML = '<div class="spinner"></div>';
    const data = await api('/api/feed/history' + qs({ q: search, local: local ? '1' : '' }), { signal });
    list.innerHTML = '';
    const render = (d) => {
      if (d.sections?.length) {
        for (const s of d.sections) {
          if (s.title) list.appendChild(el(html`<h2 class="history-day">${s.title}</h2>`));
          addItems(s.items);
        }
      } else addItems(d.items);
    };
    const addItems = (items) => {
      for (const v of items) {
        if (v.type !== 'video' && v.type !== 'short') continue;
        const row = el('<div class="history-row"></div>');
        row.appendChild(videoCard(v.type === 'short' ? { ...v, duration: 'SHORTS' } : v, 'list'));
        const rm = el(html`<button class="icon-btn h-remove" aria-label="Aus Verlauf entfernen">${raw(icon('close'))}</button>`);
        rm.onclick = async () => {
          await api('/api/history' + qs({ id: v.id }), { method: 'DELETE' }).catch((e) => toast(e.message));
          row.remove();
        };
        row.appendChild(rm);
        list.appendChild(row);
      }
    };
    render(data);
    if (!list.children.length) list.appendChild(emptyState(search ? 'Keine Treffer im Verlauf' : 'Dein Verlauf ist leer', state.settings.historyPaused ? 'Der Wiedergabeverlauf ist pausiert.' : '', 'history'));
    let cont = data.cont;
    if (cont) {
      infinite(list, async () => {
        const more = await api('/api/feed/history' + qs({ cont }), { signal });
        render(more);
        cont = more.cont;
        return !!cont;
      }, { signal });
    }
  }

  const input = node.querySelector('.history-search input');
  const localBox = node.querySelector('.h-local');
  input.addEventListener('input', debounce(() => load(input.value.trim(), localBox?.checked).catch((e) => toast(e.message)), 400));
  localBox?.addEventListener('change', () => load(input.value.trim(), localBox.checked).catch((e) => toast(e.message)));

  node.querySelector('.h-clear').onclick = () =>
    openDialog({
      title: 'Wiedergabeverlauf löschen?',
      body: html`<p>Dein Wiedergabeverlauf ${signedIn() ? 'auf diesem Handy und in deinem Google-Konto ' : ''}wird gelöscht. Gespeicherte Wiedergabepositionen werden zurückgesetzt.</p>`,
      actions: [{ label: 'Abbrechen' }, { label: 'Verlauf löschen', primary: true, run: async () => {
        await api('/api/history', { method: 'DELETE' });
        state.positions = {};
        toast('Verlauf gelöscht');
        load('', false);
      } }]
    });
  pauseBtn.onclick = async () => {
    const r = await api('/api/history/pause', { method: 'POST', body: { paused: !state.settings.historyPaused } });
    state.settings.historyPaused = r.paused;
    paintPause();
    toast(r.paused ? 'Wiedergabeverlauf pausiert' : 'Wiedergabeverlauf aktiviert');
  };

  await load(q, false);
}
