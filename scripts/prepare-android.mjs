// Bereitet den Android-Build vor:
//  1. lädt Node.js für Android (nodejs-mobile, über npm) nach android/app/libnode
//  2. packt Server + Oberfläche + benötigte node_modules nach
//     android/app/src/main/assets/nodejs-project.zip
// Aufruf: node scripts/prepare-android.mjs  (vorher: npm ci)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NODEJS_MOBILE_VERSION = '18.20.4';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'android', 'app');
const ASSETS = path.join(APP, 'src', 'main', 'assets');
const WORK = path.join(ROOT, 'android', 'build', 'prepare');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

// ---- 1. libnode ---------------------------------------------------------------
const libnode = path.join(APP, 'libnode');
if (!fs.existsSync(path.join(libnode, 'bin', 'arm64-v8a', 'libnode.so'))) {
  console.log('▶ Lade nodejs-mobile', NODEJS_MOBILE_VERSION);
  run('npm', ['pack', `nodejs-mobile-react-native@${NODEJS_MOBILE_VERSION}`, '--pack-destination', WORK], { cwd: WORK });
  const tgz = fs.readdirSync(WORK).find((f) => f.endsWith('.tgz'));
  run('tar', ['xzf', tgz, 'package/android/libnode'], { cwd: WORK });
  fs.rmSync(libnode, { recursive: true, force: true });
  fs.renameSync(path.join(WORK, 'package', 'android', 'libnode'), libnode);
}

// ---- 2. Node-Projekt ------------------------------------------------------------
const project = path.join(WORK, 'nodejs-project');
fs.mkdirSync(project, { recursive: true });

const SKIP_FILE = /(\.map|\.d\.ts|\.md|\.markdown|LICENSE\.txt|\.ts)$/i;
function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (!filter(s, entry)) continue;
    if (entry.isDirectory()) copyDir(s, d, filter);
    else if (entry.isFile() && !SKIP_FILE.test(entry.name)) fs.copyFileSync(s, d);
  }
}

copyDir(path.join(ROOT, 'server'), path.join(project, 'server'));
copyDir(path.join(ROOT, 'public'), path.join(project, 'public'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(project, 'package.json'));

// Nur Produktions-Abhängigkeiten, ohne Ballast.
const prodPaths = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && l !== ROOT && l.includes(`${path.sep}node_modules${path.sep}`));
for (const src of prodPaths) {
  const rel = path.relative(ROOT, src);
  const name = rel.replace(/^node_modules[\\/]/, '');
  const dst = path.join(project, rel);
  if (name === 'shaka-player') {
    // Vom Shaka-Player wird nur die fertige Datei gebraucht.
    fs.mkdirSync(path.join(dst, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(src, 'package.json'), path.join(dst, 'package.json'));
    fs.copyFileSync(path.join(src, 'dist', 'shaka-player.compiled.js'), path.join(dst, 'dist', 'shaka-player.compiled.js'));
    continue;
  }
  copyDir(src, dst, (s, entry) => {
    if (!entry.isDirectory()) return true;
    if (entry.name === 'node_modules') return false; // verschachtelte Pakete kommen über prodPaths
    if (name === 'youtubei.js' && entry.name === 'bundle' && path.dirname(s) === src) return false;
    return !['test', 'tests', 'docs', 'examples', '.github'].includes(entry.name);
  });
}

let version = String(Date.now());
try {
  version = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() + '-' + version;
} catch {}
fs.writeFileSync(path.join(ASSETS, 'nodejs-project.version'), version + '\n');

const zip = path.join(ASSETS, 'nodejs-project.zip');
fs.rmSync(zip, { force: true });
run('zip', ['-q', '-r', '-9', zip, '.'], { cwd: project });
console.log(`✔ nodejs-project.zip: ${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB`);
