// Гарантує, що бінарник Electron реально завантажений (node_modules/electron/dist +
// path.txt). Потрібно, бо npm-пакет electron@42 НЕ має postinstall, а його install.js
// (і навіть звичайний await) на деяких CI-раннерах виходить ще ДО завершення
// розпакування — node бачить порожній event loop і виходить ("Detected unsettled
// top-level await", exit 13) → бінарник відсутній, Playwright _electron.launch падає
// ENOENT path.txt.
//
// Фікс: ref'd keep-alive таймер тримає event loop живим, поки триває завантаження+
// розпакування; async main() (без top-level await) + ретраї + верифікація.
// Запускати з кореня пакета desktop/: `node scripts/ensure-electron.mjs`.
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

// Не дати node вийти, поки async-робота не завершилась (див. коментар вище).
const keepAlive = setInterval(() => {}, 2 ** 30);

async function main() {
  if (installed()) {
    console.log('Electron already installed:', exe);
    return;
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3 && !installed(); attempt++) {
    try {
      console.log(`Downloading Electron ${version} for ${process.platform}/${process.arch} (attempt ${attempt})…`);
      const zip = await downloadArtifact({
        version,
        artifactName: 'electron',
        platform: process.platform,
        arch: process.arch,
      });
      fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
      await extract(zip, { dir: path.join(dir, 'dist') });
      fs.writeFileSync(pathTxt, exeRel);
      console.log('Extracted Electron and wrote path.txt');
    } catch (e) {
      lastErr = e;
      console.error(`Attempt ${attempt} failed:`, e?.stack || e);
    }
  }
  if (!installed()) {
    throw new Error(`Electron binary still missing after retries. ${lastErr?.message ?? ''}`);
  }
  console.log('Electron OK:', exe);
}

main()
  .then(() => clearInterval(keepAlive))
  .catch((e) => {
    clearInterval(keepAlive);
    console.error('FATAL:', e?.stack || e);
    process.exit(1);
  });
