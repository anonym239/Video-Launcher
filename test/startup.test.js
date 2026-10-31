// Der Server muss auch starten, wenn er über einen Symlink-Pfad aufgerufen wird
// (auf Android ist /data/user/0 ein Link auf /data/data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Server startet über einen Symlink-Pfad', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-link-'));
  fs.symlinkSync(ROOT, path.join(tmp, 'link'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(tmp, 'link', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), VL_DATA_DIR: path.join(tmp, 'data') },
    stdio: 'ignore'
  });
  try {
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 200));
      ok = await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.ok, () => false);
    }
    assert.ok(ok, 'Server antwortet nicht');
  } finally {
    // Erst warten, bis der Server wirklich beendet ist, dann aufräumen.
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
