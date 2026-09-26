import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, inputSha256 } from '../debug.js';
import { parseLayoutDocument } from '../ir/validate.js';
import type { LayoutDocument } from '../ir/types.js';
import { enumerate } from './enumerate.js';

/**
 * What the detector promises beyond any one fixture's expectation, over every layout document in
 * the repository. The expectations themselves are compared in `scripts/caveat-fixtures.test.ts`,
 * next to the ledger that names them.
 *
 * - Determinism (`CAVEATS.md` #38): the same document gives the same bytes — twice in a row, after
 *   every other document has run, and with every object's keys written in the opposite order.
 * - Purity: the input is never touched (it is frozen here, so a write throws).
 * - The debug artifact accounts for every line, names its input by hash, and is canonical JSON.
 */

const root = new URL('../../../../../fixtures/', import.meta.url);
const jsonIn = (dir: string) =>
  readdirSync(new URL(dir, root))
    .filter((name) => name.endsWith('.json') && !name.endsWith('.expected.json'))
    .sort()
    .map((name) => ({
      name: `${dir}${name}`,
      json: JSON.parse(readFileSync(new URL(`${dir}${name}`, root), 'utf8')) as {
        stage?: string;
        input?: unknown;
      },
    }));

/** Every layout document the repository has: the enumerate fixtures and the three IR samples. */
const documents = [
  ...jsonIn('numbering/')
    .filter(({ json }) => json.stage === 'enumerate')
    .map(({ name, json }) => ({ name, doc: parseLayoutDocument(json.input) })),
  ...jsonIn('ir/').map(({ name, json }) => ({ name, doc: parseLayoutDocument(json) })),
];

const run = (doc: LayoutDocument) => canonicalJson(enumerate(doc));

/** The same value with every object's keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, v]) => [key, reversedKeys(v)]),
    );
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('enumerate is deterministic', () => {
  it('reads every document in the repository', () => {
    expect(documents.length).toBeGreaterThanOrEqual(24);
  });

  it('gives the same bytes twice, in either order, and whatever order the keys were written in', () => {
    const first = documents.map(({ doc }) => run(doc));
    const again = documents.map(({ doc }) => run(doc));
    const backwards = [...documents]
      .reverse()
      .map(({ doc }) => run(doc))
      .reverse();
    const rekeyed = documents.map(({ doc }) => run(reversedKeys(doc) as LayoutDocument));
    expect(again).toEqual(first);
    expect(backwards).toEqual(first);
    expect(rekeyed).toEqual(first);
  });

  it.each(documents)('never writes to its input: $name', ({ doc }) => {
    const before = canonicalJson(doc);
    const frozen = deepFreeze(structuredClone(doc));
    expect(canonicalJson(enumerate(frozen))).toBe(run(doc));
    expect(canonicalJson(frozen)).toBe(before);
  });
});

describe('the debug artifact', () => {
  it.each(documents)('accounts for every line of $name, once', ({ doc }) => {
    const { output, debug } = enumerate(doc);
    expect(debug).toMatchObject({ stage: 'enumerate', stageVersion: 1, irVersion: 1 });
    expect(debug.inputSha256).toBe(inputSha256(doc));

    const ids = debug.decisions.map((decision) => decision.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Each line is decided once in the pass — except a P4 label line, which its marker's
    // decision names as its second subject — and each item placed is judged once after it.
    const lines = doc.pages.flatMap((p) => p.blocks.flatMap((b) => b.lines.map((l) => l.id)));
    const passSubjects = debug.decisions
      .filter((d) => !d.id.startsWith('enumerate:i-'))
      .map((d) => (d.verdict === 'item' ? d.subject : d.subject.slice(0, 1)))
      .flat();
    expect([...passSubjects].sort()).toEqual([...lines].sort());

    const judged = debug.decisions.filter((d) => d.id.startsWith('enumerate:i-'));
    const kept = new Set(output.items.map((item) => item.id));
    const dropped = output.rejected.filter((r) => r.rule === 'D4').map((r) => `i-${r.lineId}`);
    expect(judged.map((d) => d.subject[0]).sort()).toEqual([...kept, ...dropped].sort());
    for (const decision of judged) {
      const item = output.items.find((i) => i.id === decision.subject[0]);
      if (item) expect([decision.rule, decision.verdict]).toEqual([item.decidedBy, item.verdict]);
      else expect([decision.rule, decision.verdict]).toEqual(['D4', 'inline-text']);
    }

    // Canonical: integers and strings only, so this does not throw.
    expect(() => canonicalJson(debug)).not.toThrow();
  });
});

describe('the output', () => {
  it.each(documents)('partitions the lines of $name', ({ doc }) => {
    const { output } = enumerate(doc);
    const lines = doc.pages.flatMap((p) => p.blocks.flatMap((b) => b.lines.map((l) => l.id)));
    const inItems = output.items.flatMap((item) => [...item.lineIds, ...item.detailLineIds]);
    const all = [...inItems, ...output.proseLineIds, ...output.skippedLineIds];
    expect(all.sort()).toEqual([...lines].sort());
    for (const item of output.items) {
      expect(item.flags).toEqual([...new Set(item.flags)].sort());
      const parent = output.items.find((other) => other.id === item.parentId);
      if (item.parentId !== null) expect(parent, `${item.id}'s parent`).toBeDefined();
    }
  });
});
