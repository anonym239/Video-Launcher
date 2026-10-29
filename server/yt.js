// Verwaltet die InnerTube-Sitzung (youtubei.js) inklusive Google-Anmeldung.
// Alles läuft lokal: kein API-Key, keine Drittserver.
import path from 'node:path';
import { Innertube, UniversalCache } from 'youtubei.js';
import { DATA_DIR, auth, store } from './store.js';
import { thumb, txt, unwrap } from './normalize.js';

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

async function loadAccount(inst) {
  try {
    const info = await inst.account.getInfo();
    const page = info.page;
    const header = findNode(page, 'ActiveAccountHeader') || findNode(page, 'AccountItem');
    if (header) {
      authState.account = {
        name: txt(header.account_name),
        handle: txt(header.channel_handle),
        photo: thumb(header.account_photo, 176),
        channelId: header.endpoint?.payload?.browseId || ''
      };
    } else {
      authState.account = { name: 'Google-Konto', handle: '', photo: '', channelId: '' };
    }
  } catch (e) {
    console.warn('[auth] Kontoinfo nicht abrufbar:', e.message);
    authState.account = authState.account || { name: 'Google-Konto', handle: '', photo: '', channelId: '' };
  }
  notify();
}

function findNode(root, type, seen = new WeakSet()) {
  root = unwrap(root);
  if (!root || typeof root !== 'object' || seen.has(root)) return null;
  seen.add(root);
  if (root.type === type) return root;
  for (const v of Array.isArray(root) ? root : Object.values(root)) {
    const r = findNode(v, type, seen);
    if (r) return r;
  }
  return null;
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

// Nach Änderungen an Sprache/Region/Login die Sitzung neu aufbauen.
export function resetYT() {
  current = null;
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
