// Ad-hoc signs the macOS app after packing, before the .dmg and .zip are made from it
// (docs/adr/0016-desktop-edition.md; the owner's Developer ID is LAUNCH-CHECKLIST §6).
//
// electron-builder's own `identity: '-'` is not enough: it skips *all* signing on a pull request
// ("code signing will be skipped"), which leaves Electron's stock signature over a bundle we have
// since changed — `codesign --verify` then fails, and an Apple Silicon Mac refuses to run it.
// Ad-hoc needs no certificate and no secret, so there is nothing to protect by skipping it.
// CommonJS, because electron-builder `require`s its hooks.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  // With the owner's Developer ID, electron-builder signs right after this hook, properly, with
  // the hardened runtime (src/packaging/signing.ts). An ad-hoc signature here would only be
  // replaced.
  if (process.env.LOPPA_MAC_SIGNING === 'developer-id') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // --deep signs the Electron frameworks and helpers inside; --force replaces their stock
  // signatures. No hardened runtime: ad-hoc is not notarised, and the runtime would only add
  // library validation to a signature that proves nothing about who made it.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
    stdio: 'inherit',
  });
};
