/**
 * Every installed dependency is under a licence a closed product may ship.
 *
 * `docs/adr/0015-reusing-open-source.md`: Loppa is proprietary, so GPL and AGPL code may not be
 * linked in, not even a little of it — and a dependency is the easiest way for some to arrive
 * unnoticed, three levels down, in a patch release. This reads what is actually installed, not
 * what `package.json` asks for, and fails on anything outside the allowlist.
 *
 * An SPDX expression passes when it can be satisfied from the allowlist: any one side of an `OR`,
 * every side of an `AND`. Anything unparseable or unknown fails — a licence nobody recognised is
 * a question for a person, not something to wave through.
 */
import { execFileSync } from 'node:child_process';

/** Permissive licences, plus the two content licences the toolchain's data and fonts use. */
const ALLOWED = new Set([
  'MIT',
  // MIT with the attribution clause removed — strictly more permissive (nodemailer).
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
  'Zlib',
  'Python-2.0',
  // Fonts (Inter): the font licence, which permits embedding in a closed product.
  'OFL-1.1',
  // Data (caniuse-lite, used at build time only): attribution, no copyleft.
  'CC-BY-4.0',
]);

/**
 * Packages allowed by name despite their licence, each with the reason it is safe.
 *
 * Only for code that runs on a developer's or CI's machine and never ships inside a product. A
 * name, not a licence: allowing WTFPL outright would let the next WTFPL package in unreviewed.
 */
export const BUILD_TOOL_EXCEPTIONS: Readonly<Record<string, string>> = {
  'truncate-utf8-bytes':
    "WTFPL — electron-builder's filename sanitiser (ADR 0016). Runs while packaging the desktop installer; not inside it.",
};

export function allowed(licence: string, name: string): boolean {
  return satisfiable(licence) || name in BUILD_TOOL_EXCEPTIONS;
}

export function satisfiable(expression: string): boolean {
  const text = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/\s+OR\s+/.test(text)) return text.split(/\s+OR\s+/).some(satisfiable);
  if (/\s+AND\s+/.test(text)) return text.split(/\s+AND\s+/).every(satisfiable);
  return ALLOWED.has(text);
}

function main(): void {
  const output = execFileSync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicence = JSON.parse(output) as Record<
    string,
    Array<{ name: string; versions: string[] }>
  >;

  const refused = Object.entries(byLicence).flatMap(([licence, packages]) =>
    packages
      .filter((pkg) => !allowed(licence, pkg.name))
      .map((pkg) => `${pkg.name}@${pkg.versions.join(',')} — ${licence}`),
  );

  const total = Object.values(byLicence).reduce((sum, packages) => sum + packages.length, 0);
  if (refused.length > 0) {
    console.error(
      'licence:check failed — not on the allowlist (docs/adr/0015-reusing-open-source.md):',
    );
    for (const line of refused) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`licence:check passed — ${total} packages, all on the allowlist`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
