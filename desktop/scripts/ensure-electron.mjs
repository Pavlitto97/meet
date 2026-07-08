// Гарантує, що бінарник Electron реально завантажений (node_modules/electron/dist +
// path.txt). Потрібно, бо npm-пакет electron@42 НЕ має postinstall, а штатний шлях
// (install.js → extract-zip) на CI-раннерах ЗАВИСАЄ на РОЗПАКУВАННІ macOS-zip
// (.app-бандл містить симлінки — extract-zip висне >3 хв). Download через @electron/get
// працює; проблема лише в extract.
//
// Тому: download через @electron/get (з таймаутом), а РОЗПАКУВАННЯ — нативним
// інструментом СИНХРОННО (ditto на macOS — еталон для .app із симлінками; tar/bsdtar
// на Windows). Синхронний execFileSync блокує потік → жодних проблем event loop/hang;
// `timeout` на ньому + ретраї + exit 1 на провал (fail-fast, не вічний hang).
// Запуск з кореня пакета desktop/: `node scripts/ensure-electron.mjs`.
import { downloadArtifact } from '@electron/get';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('node_modules/electron');
const distDir = path.join(dir, 'dist');
const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const exeRel =
  process.platform === 'win32' ? 'electron.exe'
  : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron'
  : 'electron';
const exe = path.join(distDir, exeRel);
const pathTxt = path.join(dir, 'path.txt');
const installed = () => fs.existsSync(pathTxt) && fs.existsSync(exe);

const DOWNLOAD_TIMEOUT = 180_000;
const EXTRACT_TIMEOUT = 180_000;

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), guard]);
}

// Синхронне розпакування нативним інструментом (без extract-zip — він висне на .app).
function extractZip(zip) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  const opts = { stdio: 'inherit', timeout: EXTRACT_TIMEOUT };
  if (process.platform === 'darwin') {
    execFileSync('ditto', ['-x', '-k', zip, distDir], opts); // зберігає симлінки .app
  } else if (process.platform === 'win32') {
    execFileSync('tar', ['-xf', zip, '-C', distDir], opts); // bsdtar (Win10+) розпаковує zip
  } else {
    execFileSync('unzip', ['-o', '-q', zip, '-d', distDir], opts);
  }
}

async function attempt(n) {
  console.log(`Downloading Electron ${version} for ${process.platform}/${process.arch} (attempt ${n})…`);
  const zip = await withTimeout(
    downloadArtifact({ version, artifactName: 'electron', platform: process.platform, arch: process.arch }),
    DOWNLOAD_TIMEOUT,
    'download',
  );
  console.log(`Downloaded ${zip} (${fs.statSync(zip).size} bytes); extracting with native tool…`);
  extractZip(zip);
  fs.writeFileSync(pathTxt, exeRel);
  console.log('Extracted and wrote path.txt');
}

async function main() {
  if (installed()) {
    console.log('Electron already installed:', exe);
    return;
  }
  let lastErr;
  for (let n = 1; n <= 3 && !installed(); n++) {
    try {
      await attempt(n);
    } catch (e) {
      lastErr = e;
      console.error(`Attempt ${n} failed:`, e?.message || e);
    }
  }
  if (!installed()) {
    throw new Error(`Electron binary still missing after retries. ${lastErr?.message ?? ''}`);
  }
  console.log('Electron OK:', exe);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FATAL:', e?.stack || e); process.exit(1); });
