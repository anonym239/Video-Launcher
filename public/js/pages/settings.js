import { api, el, html, raw } from '../util.js';
import { icon } from '../icons.js';
import { avatar, toast, openDialog } from '../components.js';
import { state, saveSettings, signedIn, setAuth, unblockChannel } from '../state.js';
import { loginDialog } from '../app.js';

const LANGS = [['de', 'Deutsch'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['pt', 'Português'], ['ru', 'Русский'], ['uk', 'Українська'], ['ar', 'العربية'], ['ja', '日本語']];
const REGIONS = [['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['US', 'USA'], ['GB', 'Vereinigtes Königreich'], ['FR', 'Frankreich'], ['ES', 'Spanien'], ['IT', 'Italien'], ['NL', 'Niederlande'], ['PL', 'Polen'], ['TR', 'Türkei']];
const QUALITIES = [['auto', 'Automatisch'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['144', '144p (Daten sparen)']];

export default async function settings({ node }) {
  const s = state.settings;
  const opt = (list, cur) => list.map(([v, l]) => html`<option value="${v}" ${String(cur) === v ? raw('selected') : ''}>${l}</option>`);
  node.innerHTML = html`<div class="settings-page narrow-page">
    <h1 class="page-title">Einstellungen</h1>

    <section class="settings-card">
      <h2>Konto</h2>
      <div class="account-row"></div>
    </section>

    <section class="settings-card">
      <h2>Allgemein</h2>
      <label class="setting"><span>Design</span><select data-key="theme">${opt([['system', 'Gerätedesign'], ['dark', 'Dunkel'], ['light', 'Hell']], s.theme)}</select></label>
      <label class="setting"><span>Sprache der Inhalte</span><select data-key="lang">${opt(LANGS, s.lang)}</select></label>
      <label class="setting"><span>Region (Trends, Empfehlungen)</span><select data-key="region">${opt(REGIONS, s.region)}</select></label>
      <label class="setting switch-row"><span>Eingeschränkter Modus<small>Blendet möglicherweise nicht jugendfreie Inhalte aus</small></span><input type="checkbox" data-key="restricted" ${s.restricted ? raw('checked') : ''}></label>
    </section>

    <section class="settings-card">
      <h2>Wiedergabe</h2>
      <label class="setting"><span>Bevorzugte Qualität</span><select data-key="quality">${opt(QUALITIES, s.quality)}</select></label>
      <label class="setting"><span>Standardgeschwindigkeit</span><select data-key="speed" data-num="1">${opt([['0.5', '0,5'], ['0.75', '0,75'], ['1', 'Standard'], ['1.25', '1,25'], ['1.5', '1,5'], ['2', '2']], s.speed)}</select></label>
      <label class="setting switch-row"><span>Autoplay<small>Nächstes Video automatisch abspielen</small></span><input type="checkbox" data-key="autoplay" ${s.autoplay !== false ? raw('checked') : ''}></label>
      <label class="setting switch-row"><span>Untertitel immer anzeigen</span><input type="checkbox" data-key="captions" ${s.captions ? raw('checked') : ''}></label>
    </section>

    <section class="settings-card">
      <h2>Verlauf & Datenschutz</h2>
      <label class="setting switch-row"><span>Wiedergabeverlauf pausieren</span><input type="checkbox" class="pause-history" ${s.historyPaused ? raw('checked') : ''}></label>
      <div class="setting"><span>Ausgeblendete Kanäle</span><div class="blocked-list"></div></div>
      <div class="setting-buttons">
        <a class="btn btn-tonal" href="/api/backup" download>${raw(icon('download'))}<span>Backup exportieren</span></a>
        <label class="btn btn-tonal">${raw(icon('upload'))}<span>Backup importieren</span><input type="file" accept="application/json" class="import-file" hidden></label>
      </div>
    </section>

    <section class="settings-card">
      <h2>Erweitert</h2>
      <label class="setting"><span>Client-Reihenfolge für Streams<small>Wenn Videos nicht laden, hier die Reihenfolge ändern (kommagetrennt)</small></span><input class="clients-input" value="${(s.clients || []).join(', ')}"></label>
      <p class="muted small">Optional: Ist <code>yt-dlp</code> auf dem Handy installiert (<code>pip install yt-dlp</code>), wird es automatisch als Ausweichlösung genutzt.</p>
    </section>

    <section class="settings-card about-app">
      <h2>Über</h2>
      <p>Video Launcher läuft komplett auf deinem Gerät: Inhalte werden direkt von den öffentlichen Servern abgerufen – ohne API-Key, ohne Werbung, ohne zentralen Server und ohne Datensammlung.</p>
      <p class="muted small">Unabhängiges Open-Source-Projekt (MIT-Lizenz), nicht mit YouTube oder Google verbunden. „YouTube“ ist eine Marke von Google LLC und wird hier nur zur Beschreibung der Kompatibilität genannt. Alle Inhalte gehören ihren jeweiligen Urhebern. Nutzung nur privat und auf eigene Verantwortung.</p>
      <p class="muted small">Verwendete Open-Source-Software: youtubei.js (MIT), Shaka Player (Apache-2.0), Material Icons (Apache-2.0), nodejs-mobile (MIT) – Details in THIRD_PARTY_NOTICES.md.</p>
      <p class="muted small">Tastenkürzel: K/Leertaste Pause · J/L ±10 s · ←/→ ±5 s · F Vollbild · M Ton · C Untertitel · T Kinomodus · I Miniplayer · Umschalt+N Nächstes · / Suche</p>
    </section>
  </div>`.toString();

  renderAccount(node.querySelector('.account-row'));

  node.querySelectorAll('[data-key]').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.key;
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.dataset.num) value = Number(value);
      try {
        await saveSettings({ [key]: value });
        toast('Gespeichert');
      } catch (e) {
        toast(e.message);
      }
    });
  });
  node.querySelector('.pause-history').addEventListener('change', async (e) => {
    const r = await api('/api/history/pause', { method: 'POST', body: { paused: e.target.checked } });
    state.settings.historyPaused = r.paused;
    toast(r.paused ? 'Wiedergabeverlauf pausiert' : 'Wiedergabeverlauf aktiviert');
  });
  node.querySelector('.clients-input').addEventListener('change', async (e) => {
    const clients = e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z_]+$/.test(x));
    if (!clients.length) return toast('Mindestens ein Client nötig');
    await saveSettings({ clients });
    toast('Gespeichert');
  });
  node.querySelector('.import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await api('/api/backup', { method: 'POST', body: data });
      toast('Backup importiert – Seite wird neu geladen');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast('Import fehlgeschlagen: ' + err.message);
    }
  });

  const blocked = node.querySelector('.blocked-list');
  const paintBlocked = () => {
    blocked.innerHTML = '';
    if (!state.blocked.length) blocked.appendChild(el('<span class="muted small">Keine</span>'));
    for (const c of state.blocked) {
      const chip = el(html`<button class="chip">${c.name || c.id} ${raw(icon('close'))}</button>`);
      chip.onclick = () => {
        unblockChannel(c.id);
        paintBlocked();
      };
      blocked.appendChild(chip);
    }
  };
  paintBlocked();
}

function renderAccount(box) {
  box.innerHTML = '';
  if (signedIn()) {
    const a = state.auth.account || {};
    const row = el(html`<div class="account-info">${avatar(a.photo, 48, a.name || 'G')}<div><b>${a.name || 'Google-Konto'}</b><div class="muted small">${a.handle || ''} · angemeldet über ${state.auth.method === 'cookie' ? 'Cookies' : 'Google'}</div></div><button class="btn btn-outline logout">Abmelden</button></div>`);
    row.querySelector('.logout').onclick = () =>
      openDialog({
        title: 'Abmelden?',
        body: html`<p>Die Anmeldedaten werden von diesem Handy gelöscht. Lokale Abos und Playlists bleiben erhalten.</p>`,
        actions: [{ label: 'Abbrechen' }, { label: 'Abmelden', primary: true, run: async () => {
          setAuth(await api('/api/auth/logout', { method: 'POST' }));
          renderAccount(box);
          toast('Abgemeldet');
        } }]
      });
    box.appendChild(row);
  } else {
    const row = el(html`<div class="account-info">${raw(icon('account', 'big-icon'))}<div><b>Nicht angemeldet</b><div class="muted small">Melde dich an, um deine YouTube-Abos, Playlists und Empfehlungen zu nutzen.</div></div><button class="btn btn-blue login">Anmelden</button></div>`);
    row.querySelector('.login').onclick = loginDialog;
    box.appendChild(row);
  }
}
