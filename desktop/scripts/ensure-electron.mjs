// Гарантує, що бінарник Electron реально завантажений (node_modules/electron/dist +
// path.txt). Потрібно, бо npm-пакет electron@42 НЕ має postinstall, а його install.js
// на CI часом виходить 0 ще ДО завершення async-завантаження (binary відсутній на
// момент тесту → Playwright _electron.launch падає ENOENT path.txt).
//
// На відміну від install.js, тут завантаження/розпакування ЯВНО awaited (процес не
// завершиться, поки path.txt не записано), з ретраями і повним логом помилок.
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

if (installed()) {
  console.log('Electron already installed:', exe);
} else {
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
    console.error('FATAL: Electron binary still missing after retries.', lastErr?.message ?? '');
    process.exit(1);
  }
}
console.log('Electron OK:', exe);
