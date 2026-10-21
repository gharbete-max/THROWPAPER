import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IrError, layoutProblems, parseLayoutDocument, rawProblems } from './validate.js';

/**
 * The layout validator is the gate in front of every stage of the import: it must name a problem
 * for a damaged document, never throw on one. Starting from a real sample, a seeded generator
 * damages it at random places in random ways. `FUZZ_SEED=<n>` replays a failure.
 */
const SEED = Number(process.env['FUZZ_SEED'] ?? 20261021);

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

const SAMPLE = readFileSync(
  new URL('../../../../../fixtures/ir/single-column.ir.json', import.meta.url),
  'utf8',
);

type Json = unknown;
type Container = Record<string, Json> | Json[];

/** Every object or array inside the document, with the keys one could damage. */
function containers(root: Json): Container[] {
  const found: Container[] = [];
  const walk = (value: Json) => {
    if (typeof value !== 'object' || value === null) return;
    found.push(value as Container);
    for (const child of Object.values(value)) walk(child);
  };
  walk(root);
  return found;
}

function damage(root: Json, r: ReturnType<typeof prng>): string {
  const all = containers(root);
  const target = r.pick(all);
  const keys = Object.keys(target);
  if (keys.length === 0) return 'nothing';
  const key = r.pick(keys);
  const bag = target as Record<string, Json>;
  const donor = bag[r.pick(keys)];
  const how = r.int(0, 9);
  switch (how) {
    case 0:
      if (Array.isArray(target)) target.splice(Number(key), 1);
      else delete bag[key];
      return `delete ${key}`;
    case 1:
      bag[key] = null;
      return `null ${key}`;
    case 2:
      bag[key] = 'x';
      return `string ${key}`;
    case 3:
      bag[key] = -1;
      return `-1 ${key}`;
    case 4:
      bag[key] = 10_001;
      return `10001 ${key}`;
    case 5:
      bag[key] = 0.5;
      return `0.5 ${key}`;
    case 6:
      bag[key] = donor;
      return `copy ${key}`;
    case 7:
      if (Array.isArray(target)) target.reverse();
      else bag[key] = [bag[key]];
      return `reverse/wrap ${key}`;
    case 8:
      if (Array.isArray(target)) target.push(structuredClone(donor));
      else bag[`${key}x`] = 1;
      return `add ${key}`;
    default:
      bag[key] = {};
      return `empty object ${key}`;
  }
}

describe('the layout validator under damage', () => {
  it('passes the undamaged sample, and still passes it after a JSON round trip', () => {
    expect(layoutProblems(JSON.parse(SAMPLE))).toEqual([]);
    expect(() => parseLayoutDocument(JSON.parse(JSON.stringify(JSON.parse(SAMPLE))))).not.toThrow();
  });

  it('names problems for any damage and never throws; the throwing entry throws only an IrError', () => {
    for (let i = 0; i < 1500; i += 1) {
      const r = prng(SEED + i);
      const doc = JSON.parse(SAMPLE) as Json;
      const done: string[] = [];
      for (let n = r.int(1, 4); n > 0; n -= 1) done.push(damage(doc, r));
      const ctx = `seed=${SEED + i} damage=${done.join('; ')}`;

      let problems: string[] = [];
      expect(() => (problems = layoutProblems(doc)), ctx).not.toThrow();
      expect(Array.isArray(problems) && problems.every((p) => typeof p === 'string'), ctx).toBe(
        true,
      );
      expect(() => rawProblems(doc), ctx).not.toThrow();
      try {
        parseLayoutDocument(doc);
        expect(problems, ctx).toEqual([]);
      } catch (error) {
        expect(error, ctx).toBeInstanceOf(IrError);
        expect(problems.length, ctx).toBeGreaterThan(0);
      }
    }
  });

  it('arbitrary values are never a document', () => {
    const r = prng(SEED);
    const values: unknown[] = [
      null,
      undefined,
      0,
      1,
      'x',
      [],
      {},
      [[]],
      { pages: 'no' },
      { pages: [] },
      { irVersion: 1 },
      true,
    ];
    for (const value of values) {
      expect(layoutProblems(value).length, JSON.stringify(value)).toBeGreaterThan(0);
    }
    // A very large, very deep value fails by shape, quickly.
    let deep: unknown = {};
    for (let i = 0; i < 2000; i += 1) deep = { pages: [deep] };
    const started = Date.now();
    expect(layoutProblems(deep).length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2000);
    void r;
  });
});
