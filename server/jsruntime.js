// JavaScript-Auswerter für youtubei.js: Führt den aus dem YouTube-Player extrahierten
// Entschlüsselungscode (Signatur / "n"-Parameter) aus. Ohne ihn lassen sich viele
// Video-URLs nicht abspielen. Der Code läuft in einem eigenen vm-Kontext ohne Zugriff
// auf Dateien, Prozess oder Netzwerk.
import vm from 'node:vm';
import { Platform } from 'youtubei.js';

const TIMEOUT_MS = 5000;

function sandbox() {
  const ctx = {
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    navigator: { userAgent: 'Mozilla/5.0', language: 'de-DE' },
    location: { href: 'https://www.youtube.com/', hostname: 'www.youtube.com', origin: 'https://www.youtube.com', protocol: 'https:' },
    document: {}
  };
  ctx.window = ctx;
  ctx.self = ctx;
  return vm.createContext(ctx);
}

export function evaluate(data, env) {
  // data.output ist ein Funktionsrumpf, der mit "return process(n, sp, s)" endet.
  const code = `(function () {\n${data.output}\n})()`;
  const result = vm.runInContext(code, sandbox(), { timeout: TIMEOUT_MS });
  // Ergebnis aus dem fremden Kontext in ein normales Objekt kopieren.
  return result && typeof result === 'object' ? { sig: result.sig, n: result.n } : result;
}

export function installEvaluator() {
  Platform.shim.eval = evaluate;
}
