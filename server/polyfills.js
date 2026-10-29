// Ergänzungen für Node.js-Builds ohne Internationalisierung (nodejs-mobile auf Android
// hat kein `Intl`). Muss als erstes Modul geladen werden.
if (typeof globalThis.Intl === 'undefined') {
  const timeZone = process.env.TZ || 'UTC';
  const DateTimeFormat = function () {
    return { resolvedOptions: () => ({ timeZone, locale: 'de-DE' }), format: (d) => new Date(d ?? Date.now()).toISOString() };
  };
  const NumberFormat = function () {
    return { format: (n) => String(n) };
  };
  globalThis.Intl = { DateTimeFormat, NumberFormat };
}

// 1234567 -> "1.234.567" (unabhängig von ICU)
export function formatNumberDe(n) {
  const s = String(Math.trunc(Number(n) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
