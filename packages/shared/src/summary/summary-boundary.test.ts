import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `docs/plan/DOCUMENTS.md` section 4, ADR 0023 section 4: the model never runs in
 * `packages/shared/src/{builder,interpret,import}`. The builder and the import stay deterministic
 * (ADR 0019); the summary centre is the one exception and it lives elsewhere.
 *
 * This reads the source: nothing there imports the model runtime, the summary folder or its
 * bridge, or reaches for `window.loppaModel`. Rule-based recognition of documents that must be
 * quoted (`import/quoted`) is allowed because it is a word list, and this test is what keeps it one.
 */
const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the deterministic parts stay deterministic', () => {
  for (const dir of ['builder', 'interpret', 'import']) {
    it(`${dir} never reaches the model`, () => {
      const offenders = files(join(SRC, dir)).filter((path) => {
        const source = readFileSync(path, 'utf8');
        return (
          /from\s+['"][^'"]*(node-llama-cpp|\/summary\/|\.\.\/summary|@tp\/shared\/summary|\/ai\/|\.\.\/ai|@tp\/shared\/ai)/.test(
            source,
          ) || /loppaModel|utilityProcess|llama\.cpp/.test(source)
        );
      });
      expect(offenders.map((p) => p.slice(SRC.length))).toEqual([]);
    });
  }
});
