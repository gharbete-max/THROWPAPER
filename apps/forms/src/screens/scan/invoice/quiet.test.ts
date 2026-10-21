import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reading an invoice keeps the invoice on the machine (`docs/plan/CAVEATS.md` #43, `privacy`) and
 * never asks a model (HANDOVER decision 5, ADR 0019): the screen's files cannot reach the server,
 * and the rules in `@tp/shared/payable` import nothing but zod and each other.
 */
const SCREEN = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RULES = new URL(
  '../../../../../../packages/shared/src/payable/',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sources = (dir: string) =>
  readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));

describe('the invoice reader', () => {
  it('never talks to the server', () => {
    for (const name of sources(SCREEN)) {
      expect(readFileSync(join(SCREEN, name), 'utf8'), name).not.toMatch(
        /lib\/api|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/,
      );
    }
  });

  it('keeps its rules pure: relative imports and zod only', () => {
    for (const name of sources(RULES)) {
      const imports = [...readFileSync(join(RULES, name), 'utf8').matchAll(/from '([^']+)'/g)].map(
        (m) => m[1]!,
      );
      for (const from of imports) {
        expect(from.startsWith('.') || from === 'zod', `${name} imports ${from}`).toBe(true);
      }
    }
  });

  it('keeps the heavy parts lazy: only Entry is reachable from Scan without a dynamic import', () => {
    const scan = readFileSync(join(SCREEN, '..', 'Scan.tsx'), 'utf8');
    expect(scan).toContain("from './invoice/Entry.js'");
    expect(scan).not.toMatch(/invoice\/(?!Entry)/);
    expect(readFileSync(join(SCREEN, 'Entry.tsx'), 'utf8')).toContain("import('./InvoiceScan.js')");
  });
});
