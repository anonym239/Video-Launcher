import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Utils, Platform } from 'youtubei.js';
import { evaluate, installEvaluator } from '../server/jsruntime.js';

// Nachbau dessen, was youtubei.js aus dem YouTube-Player extrahiert:
// ein Objekt "exportedVars" mit einer nsigFunction, die eine URL-Klasse liefert.
const fakePlayerScript = `const exportedVars = (function () {
  function nsigFunction(url, sp, s) {
    const u = new URL(url);
    return new (class {
      transform() {
        u.searchParams.set('n', u.searchParams.get('n').split('').reverse().join(''));
        if (s) u.searchParams.set(sp || 'signature', s.toUpperCase());
      }
      get(k) { return u.searchParams.get(k); }
      set(k, v) { u.searchParams.set(k, v); }
    })();
  }
  return { nsigFunction };
})();`;

const run = (env) => evaluate({ output: `${fakePlayerScript}\n${Utils.getNsigProcessorFn(env.n, env.sp, env.sig)}`, exported: ['nsigFunction'] }, env);

test('Auswerter entschlüsselt n-Parameter und Signatur', () => {
  assert.deepEqual(run({ n: 'abc123' }), { sig: undefined, n: '321cba' });
  assert.deepEqual(run({ n: 'xy', sig: 'secret', sp: 'sig' }), { sig: 'SECRET', n: 'yx' });
});

test('Auswerter läuft abgeschottet (kein Zugriff auf require, fetch, Buffer)', () => {
  const out = evaluate({ output: 'return { n: [typeof require, typeof fetch, typeof Buffer, typeof module].join(",") };' }, {});
  assert.equal(out.n, 'undefined,undefined,undefined,undefined');
});

test('Endlosschleifen werden abgebrochen', () => {
  assert.throws(() => evaluate({ output: 'while (true) {}' }, {}), /timed out/);
});

test('Auswerter wird bei youtubei.js registriert', () => {
  installEvaluator();
  assert.equal(Platform.shim.eval, evaluate);
});
