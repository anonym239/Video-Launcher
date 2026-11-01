// Verwaltet die InnerTube-Sitzung (youtubei.js) inklusive Google-Anmeldung.
// Alles läuft lokal: kein API-Key, keine Drittserver.
import './polyfills.js';
import path from 'node:path';
import { Innertube, UniversalCache } from 'youtubei.js';
import { DATA_DIR, auth, store } from './store.js';
import { installEvaluator } from './jsruntime.js';

installEvaluator();

let current = null; // Promise<Innertube>
let pending = null; // laufender Geräte-Login
const listeners = new Set();

export const authState = {
  status: 'signed_out', // signed_out | pending | signed_in | error
  method: null, // oauth | cookie
  code: null,
  url: null,
  expires: 0,
  error: null,
  account: null
};

// Gespeicherte Anmeldung sofort übernehmen – auch ohne Internet (Offline-Modus)
// gilt man als angemeldet, sonst würde die Anmeldeseite die Downloads verdecken.
{
  const cfg = auth.data || {};
  if ((cfg.method === 'cookie' && cfg.cookie) || (cfg.method === 'oauth' && cfg.tokens)) {
    authState.status = 'signed_in';
    authState.method = cfg.method;
    authState.account = cfg.account || null;
  }
}

function notify() {
  for (const fn of listeners) fn(authState);
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function baseOptions() {
  const s = store.settings;
  return {
    lang: s.lang || 'de',
    location: s.region || 'DE',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC',
    enable_safety_mode: !!s.restricted,
    retrieve_player: true,
    generate_session_locally: false,
    cache: new UniversalCache(true, path.join(DATA_DIR, 'cache'))
  };
}

function persistTokens(inst) {
  const o = inst.session.oauth;
  if (!o?.oauth2_tokens) return;
  auth.data = { method: 'oauth', tokens: { ...o.oauth2_tokens, client: o.oauth2_tokens.client || o.client_id } };
  auth.flush();
}

async function create() {
  const cfg = auth.data || {};
  const opts = baseOptions();
  if (cfg.method === 'cookie' && cfg.cookie) opts.cookie = cfg.cookie;
  const inst = await Innertube.create(opts);

  if (cfg.method === 'oauth' && cfg.tokens) {
    inst.session.on('update-credentials', () => persistTokens(inst));
    try {
      await inst.session.signIn(cfg.tokens);
      persistTokens(inst);
      authState.status = 'signed_in';
      authState.method = 'oauth';
    } catch (e) {
      console.warn('[auth] Token ungültig, abgemeldet:', e.message);
      auth.data = {};
      auth.flush();
      authState.status = 'signed_out';
      authState.method = null;
    }
  } else if (cfg.method === 'cookie' && cfg.cookie) {
    authState.status = 'signed_in';
    authState.method = 'cookie';
  } else {
    authState.status = 'signed_out';
    authState.method = null;
  }
  if (authState.status === 'signed_in') loadAccount(inst);
  else authState.account = null;
  notify();
  return inst;
}

// Sucht im rohen InnerTube-JSON nach Kontodaten (Name, Bild, Handle, Kanal).
// Die Antworten unterscheiden sich je nach Client (WEB/TV), deshalb generisch.
export function extractAccount(root) {
  const found = [];
  let channelId = '';
  const text = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join('') || t.content || '' : '');
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.accountName && (n.accountPhoto || n.channelHandle)) {
      found.push({
        name: text(n.accountName),
        handle: text(n.channelHandle) || text(n.accountByline),
        photo: (n.accountPhoto?.thumbnails || []).slice(-1)[0]?.url || '',
        selected: n.isSelected !== false,
        channelId: n.serviceEndpoint?.selectActiveIdentityEndpoint?.supportedTokens?.find?.((t) => t.pageIdToken)?.pageIdToken?.pageId || ''
      });
    }
    const bid = n.browseEndpoint?.browseId;
    if (!channelId && typeof bid === 'string' && /^UC[\w-]{22}$/.test(bid)) channelId = bid;
    for (const v of Object.values(n)) walk(v);
  };
  walk(root);
  const acc = found.find((a) => a.selected && a.name) || found.find((a) => a.name);
  if (!acc) return null;
  let photo = acc.photo;
  if (photo.startsWith('//')) photo = 'https:' + photo;
  // Größeres Profilbild anfordern (=s88 → =s176).
  photo = photo.replace(/=s\d+(-[^/]*)?$/, '=s176$1');
  return { name: acc.name, handle: acc.handle, photo, channelId: channelId || '' };
}

async function loadAccount(inst) {
  const sources = [
    () => inst.actions.execute('/account/account_menu', { client: 'WEB', parse: false }),
    () => inst.actions.execute('/account/accounts_list', { client: 'TV', parse: false }),
    () => inst.actions.execute('/account/accounts_list', { client: 'WEB', parse: false, requestType: 'ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER', callCircumstance: 'SWITCHING_USERS_FULL' })
  ];
  let account = null;
  for (const src of sources) {
    try {
      const res = await src();
      account = extractAccount(res?.data ?? res);
      if (account) break;
    } catch (e) {
      console.warn('[auth] Kontoinfo-Quelle fehlgeschlagen:', e.message);
    }
  }
  // Kanal-ID fehlt? Über das Hauptmenü des Kontos nachschlagen.
  if (account && !account.channelId) {
    try {
      const res = await inst.actions.execute('/browse', { browseId: 'SPaccount_overview', client: 'WEB', parse: false });
      account.channelId = extractAccount(res?.data)?.channelId || '';
    } catch {}
  }
  authState.account = account || authState.account || { name: 'Google-Konto', handle: '', photo: '', channelId: '' };
  // Für den Offline-Start merken (Name/Bild im Kopf).
  if (account && auth.data?.method) {
    auth.data.account = account;
    auth.save();
  }
  notify();
}


export function getYT() {
  if (!current) {
    current = create().catch((e) => {
      current = null;
      throw e;
    });
  }
  return current;
}

// Zweite Sitzung OHNE Anmeldung – nur für Video-Streams und Downloads.
// Mit Login-Cookies lehnen die schnellen App-Clients (ANDROID_VR, iOS …) Anfragen
// oft ab oder liefern Links, die beim Laden scheitern. Streams brauchen keinen
// Login; die angemeldete Sitzung dient nur als Rückfall (z. B. Altersfreigabe).
let anon = null;
export function getStreamYT() {
  if (!anon) {
    anon = Innertube.create(baseOptions()).catch((e) => {
      anon = null;
      throw e;
    });
  }
  return anon;
}

// Nach Änderungen an Sprache/Region/Login die Sitzung neu aufbauen.
export function resetYT() {
  current = null;
  anon = null;
  return getYT();
}

export const isSignedIn = () => authState.status === 'signed_in';

// ---- Anmeldung über Google (Geräte-Code auf google.com/device) -------------
export async function startOAuth() {
  cancelOAuth();
  const inst = await Innertube.create({ ...baseOptions() });
  const token = {};
  pending = token;

  return new Promise((resolve, reject) => {
    inst.session.on('auth-pending', (data) => {
      if (pending !== token) return;
      authState.status = 'pending';
      authState.method = 'oauth';
      authState.code = data.user_code;
      authState.url = data.verification_url || 'https://www.google.com/device';
      authState.expires = Date.now() + (data.expires_in || 1800) * 1000;
      authState.error = null;
      notify();
      resolve({ code: authState.code, url: authState.url, expires: authState.expires });
    });
    inst.session.on('auth', () => {
      if (pending !== token) return;
      pending = null;
      persistTokens(inst);
      authState.code = null;
      authState.url = null;
      current = Promise.resolve(inst);
      authState.status = 'signed_in';
      authState.method = 'oauth';
      notify();
      loadAccount(inst);
    });
    inst.session.on('update-credentials', () => {
      if (pending === null) persistTokens(inst);
    });
    inst.session.on('auth-error', (err) => {
      if (pending !== token) return;
      pending = null;
      authState.status = 'error';
      authState.error = err?.message || 'Anmeldung fehlgeschlagen';
      authState.code = null;
      notify();
      reject(err);
    });
    // Nicht auf das Ende warten: signIn() löst erst nach erfolgreichem Login auf.
    inst.session.oauth.init().catch((e) => {
      if (pending !== token) return;
      pending = null;
      authState.status = 'error';
      authState.error = e?.message || String(e);
      notify();
      reject(e);
    });
  });
}

export function cancelOAuth() {
  pending = null;
  if (authState.status === 'pending' || authState.status === 'error') {
    authState.status = auth.data?.method ? 'signed_in' : 'signed_out';
    authState.code = null;
    authState.url = null;
    authState.error = null;
    notify();
  }
}

// ---- Anmeldung mit Browser-Cookies (Alternative für Fortgeschrittene) -----
export async function cookieLogin(cookie) {
  cookie = String(cookie || '').trim().replace(/^cookie:\s*/i, '');
  if (!/(SAPISID|__Secure-3PAPISID)=/.test(cookie)) {
    throw Object.assign(new Error('Die Cookies enthalten kein SAPISID / __Secure-3PAPISID. Bitte den kompletten Cookie-Header von youtube.com einfügen.'), { status: 400 });
  }
  auth.data = { method: 'cookie', cookie };
  auth.flush();
  await resetYT();
  return authState;
}

export async function signOut() {
  const cfg = auth.data || {};
  if (cfg.method === 'oauth') {
    try {
      const yt = await getYT();
      await yt.session.signOut();
    } catch {
      /* Widerruf ist optional */
    }
  }
  auth.data = {};
  auth.flush();
  authState.account = null;
  await resetYT();
  return authState;
}
