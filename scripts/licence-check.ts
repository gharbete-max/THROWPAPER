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

  const refused = Object.entries(byLicence)
    .filter(([licence]) => !satisfiable(licence))
    .flatMap(([licence, packages]) =>
      packages.map((pkg) => `${pkg.name}@${pkg.versions.join(',')} — ${licence}`),
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
