// Globaler App-Zustand: Einstellungen, Anmeldung, Wiedergabepositionen.
import { api, storage } from './util.js';

const listeners = new Map();

export const state = {
  settings: {},
  auth: { status: 'signed_out', account: null },
  positions: {},
  blocked: storage.get('blockedChannels', []), // lokal ausgeblendete Kanäle
  hidden: new Set(storage.get('hiddenVideos', [])),
  subs: new Set(), // IDs abonnierter Kanäle
  queue: [] // "Zur Wiedergabeliste hinzufügen"
};

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}

export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  }
}

export const signedIn = () => state.auth.status === 'signed_in';

export async function loadStatus() {
  const s = await api('/api/status');
  state.settings = s.settings;
  setAuth(s.auth);
  applyTheme();
  try {
    state.positions = (await api('/api/positions')).positions || {};
  } catch {}
}

export function setAuth(a) {
  const changed = a.status !== state.auth.status || JSON.stringify(a.account) !== JSON.stringify(state.auth.account);
  state.auth = a;
  if (changed) emit('auth', a);
}

export async function saveSettings(patch) {
  state.settings = await api('/api/settings', { method: 'POST', body: patch });
  applyTheme();
  emit('settings', state.settings);
  return state.settings;
}

export function applyTheme() {
  const t = state.settings.theme || 'dark';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0f0f' : '#ffffff');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

export function setPosition(id, t, d) {
  if (!id) return;
  if (!t || (d && t > d - 10)) delete state.positions[id];
  else state.positions[id] = Math.floor(t);
}

export function progressOf(id, durationSec) {
  const p = state.positions[id];
  if (!p || !durationSec) return 0;
  return Math.min(100, (p / durationSec) * 100);
}

export function blockChannel(ch) {
  if (!ch?.id || state.blocked.some((c) => c.id === ch.id)) return;
  state.blocked.push({ id: ch.id, name: ch.name || '' });
  storage.set('blockedChannels', state.blocked);
}

export function unblockChannel(id) {
  state.blocked = state.blocked.filter((c) => c.id !== id);
  storage.set('blockedChannels', state.blocked);
}

export function hideVideo(id) {
  state.hidden.add(id);
  storage.set('hiddenVideos', [...state.hidden].slice(-2000));
}

export function isFiltered(item) {
  if (!item) return true;
  if (item.id && state.hidden.has(item.id)) return true;
  const cid = item.channel?.id;
  if (cid && state.blocked.some((c) => c.id === cid)) return true;
  return false;
}
