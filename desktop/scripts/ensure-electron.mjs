// Гарантує, що бінарник Electron реально завантажений (node_modules/electron/dist +
// path.txt). Потрібно, бо npm-пакет electron@42 НЕ має postinstall, а його install.js
// на CI поводиться зле: або виходить ДО завершення розпакування ("unsettled top-level
// await"), або download-зʼєднання на раннері ЗАВИСАЄ без таймауту (годинами).
//
// Тут кожна async-операція (download/extract) обгорнута таймаутом: pending-таймер
// тримає event loop живим (нема передчасного виходу) І жорстко обмежує зависання
// (timeout → reject → ретрай). Без таймаута — fail-fast (exit 1), НЕ вічний hang.
// Запуск з кореня пакета desktop/: `node scripts/ensure-electron.mjs`.
import { downloadArtifact } from '@electron/get';
import extract from 'extract-zip';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('node_modules/electron');
const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const exeRel =
  process.platform === 'win32' ? 'electron.exe'
  : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron'
  : 'electron';
const exe = path.join(dir, 'dist', exeRel);
const pathTxt = path.join(dir, 'path.txt');
const installed = () => fs.existsSync(pathTxt) && fs.existsSync(exe);

const DOWNLOAD_TIMEOUT = 180_000;
const EXTRACT_TIMEOUT = 180_000;

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  // promise.finally чистить таймер; race повертає результат або timeout-reject.
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), guard]);
}

async function attempt(n) {
  console.log(`Downloading Electron ${version} for ${process.platform}/${process.arch} (attempt ${n})…`);
  const zip = await withTimeout(
    downloadArtifact({ version, artifactName: 'electron', platform: process.platform, arch: process.arch }),
    DOWNLOAD_TIMEOUT,
    'download',
  );
  console.log(`Downloaded ${zip} (${fs.statSync(zip).size} bytes); extracting…`);
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  await withTimeout(extract(zip, { dir: path.join(dir, 'dist') }), EXTRACT_TIMEOUT, 'extract');
  fs.writeFileSync(pathTxt, exeRel);
  console.log('Wrote path.txt');
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
