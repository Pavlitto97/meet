// electron-builder `afterPack` hook — keep secrets OUT of the distributable.
//
// The installer bakes resources/.env (copied from desktop/.env) so the main process
// can read GH_TOKEN for auto-update of the PRIVATE repo. That is the ONLY secret that
// legitimately needs to travel with the app. The OpenRouter key must NOT ship — every
// user pastes their own in Settings (it lives only in their local DB).
//
// This rewrites the SHIPPED .env to an allowlist: anything not in SHIP_ALLOWLIST is
// dropped. The guarantee is structural — even if someone later re-adds OPENROUTER_API_KEY
// (or any other secret) to desktop/.env, it can never end up inside a build artifact.
// Runs after packaging but BEFORE code signing, so it never invalidates a signature.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The only keys allowed to travel inside the installer.
const SHIP_ALLOWLIST = ['GH_TOKEN', 'GITHUB_TOKEN'];

/**
 * Pure helper: keep only allowlisted `KEY=VALUE` lines; drop comments, blanks and
 * everything else. Returns the new text plus which keys were kept/dropped (names only —
 * never values, so logs stay secret-free).
 */
function sanitizeEnvText(text, allowlist = SHIP_ALLOWLIST) {
  const kept = [];
  const dropped = [];
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) continue; // comment / blank / junk → drop
    const key = m[1];
    if (allowlist.includes(key)) {
      kept.push(key);
      out.push(raw.trim());
    } else {
      dropped.push(key);
    }
  }
  return { text: out.length ? out.join('\n') + '\n' : '', kept, dropped };
}

/** Platform-correct path to the packed app's resources dir (where extraResources land). */
function resourcesDirFor(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  if (packager && typeof packager.getResourcesDir === 'function') {
    return packager.getResourcesDir(appOutDir);
  }
  if (electronPlatformName === 'darwin') {
    const appName = packager.appInfo.productFilename;
    return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  }
  return path.join(appOutDir, 'resources');
}

module.exports = async function sanitizeShipEnv(context) {
  const envFile = path.join(resourcesDirFor(context), '.env');
  if (!fs.existsSync(envFile)) {
    console.log(`[sanitize-ship-env] no .env at ${envFile} — nothing to strip`);
    return;
  }
  const { text, kept, dropped } = sanitizeEnvText(fs.readFileSync(envFile, 'utf8'));
  fs.writeFileSync(envFile, text, { mode: 0o600 });
  console.log(
    `[sanitize-ship-env] ${envFile}: shipped [${kept.join(', ') || '—'}], dropped [${dropped.join(', ') || '—'}]`
  );
};

// Exposed for unit tests.
module.exports.sanitizeEnvText = sanitizeEnvText;
module.exports.SHIP_ALLOWLIST = SHIP_ALLOWLIST;
