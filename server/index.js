// Video Launcher – lokaler Server. Läuft auf dem Handy (z. B. in Termux) und liefert
// die Weboberfläche sowie die YouTube-Daten ohne Werbung und ohne API-Key.
import './polyfills.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { routes, httpError } from './api.js';
import { proxy } from './stream.js';
import { getYT } from './yt.js';
import { store } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const LAN = args.includes('--lan') || process.env.VL_LAN === '1';
const PORT = Number(process.env.PORT || (args.find((a) => a.startsWith('--port='))?.split('=')[1]) || 8080);
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const VENDOR = {
  '/vendor/shaka-player.js': path.join(ROOT, 'node_modules/shaka-player/dist/shaka-player.compiled.js')
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Routen mit Platzhaltern (":id") vorbereiten.
const compiled = Object.entries(routes).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, n) => (names.push(n), '([^/]+)')) + '$');
  return { method, re, names, handler };
});

function matchRoute(method, pathname) {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) {
      const params = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
  }
  return null;
}

// Schutz vor DNS-Rebinding: nur localhost bzw. IP-Adressen (im LAN-Modus) zulassen.
export function hostAllowed(hostHeader, lan = LAN) {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (lan && (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.endsWith('.local'))) return true;
  return false;
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'Anfrage zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function serveFile(req, res, file, cache = 'no-cache') {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Nicht gefunden');
    }
    const mtime = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === mtime) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'last-modified': mtime,
      'cache-control': cache,
      'x-content-type-options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function handle(req, res) {
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Host nicht erlaubt');
  }
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (pathname === '/vp') return proxy(req, res, url.searchParams);

  if (pathname.startsWith('/api/')) {
    // Schreibende Anfragen nur mit eigenem Header (verhindert CSRF von fremden Webseiten).
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-vl'] !== '1') {
      return sendJson(res, 403, { error: 'Fehlender Sicherheits-Header' });
    }
    const m = matchRoute(req.method === 'HEAD' ? 'GET' : req.method, pathname);
    if (!m) return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
    try {
      const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      const out = await m.handler(url.searchParams, m.params, body);
      if (out && out.__raw !== undefined) {
        const headers = { 'content-type': out.__type || 'text/plain', 'cache-control': 'no-store' };
        if (out.__download) headers['content-disposition'] = `attachment; filename="${out.__download}"`;
        res.writeHead(200, headers);
        return res.end(out.__raw);
      }
      return sendJson(res, 200, out ?? {});
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(`[api] ${req.method} ${pathname}:`, e?.stack || e);
      return sendJson(res, status, { error: e.message || 'Unbekannter Fehler' });
    }
  }

  if (VENDOR[pathname]) return serveFile(req, res, VENDOR[pathname], 'public, max-age=86400');

  // Statische Dateien
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = path.join(PUBLIC, rel);
  if (file.startsWith(PUBLIC + path.sep) && path.extname(file) && fs.existsSync(file)) return serveFile(req, res, file);

  // Alle anderen Pfade (/watch, /shorts/…, /@kanal …) gehören zur Single-Page-App.
  return serveFile(req, res, path.join(PUBLIC, 'index.html'));
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// Auf dem Handy darf ein einzelner Fehler nie den ganzen Server (und damit die App) beenden.
process.on('uncaughtException', (e) => console.error('[fehler]', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[fehler] unbehandelt:', e?.stack || e));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log('\n  ▶ Video Launcher läuft');
    console.log(`    Auf diesem Handy:  http://localhost:${PORT}`);
    if (LAN) for (const ip of lanAddresses()) console.log(`    Im WLAN:           http://${ip}:${PORT}`);
    console.log('    Beenden mit Strg+C\n');
    // Sitzung schon vorab aufbauen, damit die erste Seite schneller lädt.
    getYT().catch((e) => console.warn('[yt] Sitzung konnte nicht erstellt werden:', e.message));
  });
  const stop = () => {
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
