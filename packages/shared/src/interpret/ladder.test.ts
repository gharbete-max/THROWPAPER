import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BUILDER_GRAPH } from '../builder/graph/nodes.js';
import { BUILTIN_ALIASES } from './aliases.js';
import {
  COMPARISON_BUDGET,
  chipOf,
  interpret,
  toAnswer,
  type AskReason,
  type Interpretation,
} from './ladder.js';
import { LANGUAGES, type Language } from './lexicon.js';
import { PATTERN_KINDS, readPattern } from './patterns.js';

/**
 * The phrase tables — `docs/plan/INTENT-LADDER.md`, "Tests". `fixtures/ladder/<language>.json`
 * holds, per shipped language, phrases typed at a node and what the ladder must make of each:
 * an option or a value and the tier that read it, or the reason it must ask instead. Changing an
 * alias, a word list or a threshold changes a row here in the same commit (`CLAUDE.md`).
 */

const DIR = new URL('../../../../fixtures/ladder/', import.meta.url);
const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'] as const;
/** At least this many rows per tier and language, and as many that must ask. */
const PER_TIER = 10;
/** Chinese and Japanese are read as character bigrams, which T3 never compares fuzzily. */
const NO_FUZZY: readonly Language[] = ['zh', 'ja'];

const ASK_REASONS = [
  'nothing',
  'ambiguous',
  'negated',
  'vague',
  'out-of-range',
  'budget',
  'too-long',
  'not-readable',
] as const satisfies readonly AskReason[];

const Expect = z.union([
  z.object({ optionId: z.string(), tier: z.enum(TIERS) }).strict(),
  z.object({ value: z.unknown(), tier: z.literal('T4') }).strict(),
  z.object({ ask: z.enum(ASK_REASONS) }).strict(),
  z.object({ none: z.literal(true) }).strict(),
]);
const Row = z
  .object({
    phrase: z.string(),
    nodeId: z.string().optional(),
    pattern: z.enum(PATTERN_KINDS).optional(),
    expect: Expect,
    note: z.string().optional(),
  })
  .strict()
  .refine(
    (row) => (row.nodeId === undefined) !== (row.pattern === undefined),
    'a node or a pattern',
  );
const Table = z
  .object({
    language: z.enum(LANGUAGES),
    locale: z.string(),
    source: z.string().min(1),
    rows: z.array(Row).min(1),
  })
  .strict();
type Row = z.infer<typeof Row>;
type Table = z.infer<typeof Table>;

const files = readdirSync(DIR).filter((name) => name.endsWith('.json'));
const tables: Table[] = files.map((name) =>
  Table.parse(JSON.parse(readFileSync(new URL(name, DIR), 'utf8'))),
);

/** What the ladder made of a row, in the shape of its expectation. */
function outcome(table: Table, row: Row, aliases = BUILTIN_ALIASES): unknown {
  if (row.pattern) {
    const read = readPattern(row.pattern, row.phrase, table.language);
    return read ? { value: read.value, tier: 'T4' } : { none: true };
  }
  const result = interpret(row.phrase, {
    graph: BUILDER_GRAPH,
    nodeId: row.nodeId!,
    locale: table.locale,
    aliases,
  });
  if (result.outcome === 'ask') return { ask: result.reason };
  const { reading } = result;
  return reading.optionId === null
    ? { value: reading.value, tier: reading.tier }
    : { optionId: reading.optionId, tier: reading.tier };
}

describe('the phrase tables', () => {
  it('cover every shipped language', () => {
    expect(tables.map((t) => t.language).sort()).toEqual([...LANGUAGES].sort());
    for (const table of tables) expect(files).toContain(`${table.language}.json`);
  });

  describe.each(tables.map((t) => [t.language, t] as const))('%s', (language, table) => {
    it.each(table.rows.map((row) => [row.nodeId ?? `#${row.pattern}`, row.phrase, row] as const))(
      '%s: %j',
      (_at, _phrase, row) => {
        expect(outcome(table, row)).toEqual(row.expect);
      },
    );

    it(`has at least ${PER_TIER} rows per tier, and as many that must ask`, () => {
      const count = (tier: string) =>
        table.rows.filter((r) => 'tier' in r.expect && r.expect.tier === tier).length;
      for (const tier of TIERS) {
        if (tier === 'T3' && NO_FUZZY.includes(language)) continue;
        expect(count(tier), tier).toBeGreaterThanOrEqual(PER_TIER);
      }
      const asks = table.rows.filter((r) => 'ask' in r.expect || 'none' in r.expect).length;
      expect(asks).toBeGreaterThanOrEqual(PER_TIER);
    });

    it('never reads Chinese or Japanese fuzzily', () => {
      if (!NO_FUZZY.includes(language)) return;
      expect(table.rows.filter((r) => 'tier' in r.expect && r.expect.tier === 'T3')).toEqual([]);
    });
  });
});

/** A seeded shuffle: the same "random" order on every run. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function everything(aliases = BUILTIN_ALIASES): string {
  const results: unknown[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.pattern) {
        results.push(readPattern(row.pattern, row.phrase, table.language));
        continue;
      }
      results.push(
        interpret(row.phrase, {
          graph: BUILDER_GRAPH,
          nodeId: row.nodeId!,
          locale: table.locale,
          aliases,
        }),
      );
    }
  }
  return JSON.stringify(results);
}

describe('the same input, the same output', () => {
  it('reads every row the same way twice, and with the aliases in any order', () => {
    const once = everything();
    expect(everything()).toBe(once);
    expect(everything(shuffled(BUILTIN_ALIASES, 7))).toBe(once);
    expect(everything([...BUILTIN_ALIASES].reverse())).toBe(once);
  });
});

describe('a reading', () => {
  const read = (phrase: string, nodeId: string, locale = 'en-GB'): Interpretation =>
    interpret(phrase, { graph: BUILDER_GRAPH, nodeId, locale });

  it('points at what was typed, however normalisation reshaped it', () => {
    // `ﬁ` is one character that NFKC makes two; the span is still of the input.
    const typed = 'the ﬁnal answer: several answers';
    const result = read(typed, 'choice.answers');
    expect(result.outcome).toBe('apply');
    if (result.outcome !== 'apply') return;
    const [start, end] = result.reading.evidenceSpan;
    expect(typed.slice(start, end)).toBe('several answers');
  });

  it('offers the other options, most likely first, to "change" to', () => {
    const result = read('pills please', 'choice.shape');
    expect(result.outcome).toBe('apply');
    if (result.outcome !== 'apply') return;
    expect(result.reading.alternatives.map((a) => a.optionId)).toEqual([
      'rounded',
      'square',
      'tile',
    ]);
  });

  it('asks with the node’s own options when it cannot read', () => {
    const result = read('banana', 'choice.shape');
    expect(result).toMatchObject({ outcome: 'ask', reason: 'nothing' });
    if (result.outcome !== 'ask') return;
    expect(result.options.map((o) => [o.optionId, o.tier])).toEqual([
      ['pill', 'T8'],
      ['rounded', 'T8'],
      ['square', 'T8'],
      ['tile', 'T8'],
    ]);
  });

  it('becomes the answer the machine takes, with its tier on the chip', () => {
    const option = read('several', 'choice.answers');
    const quantity = read('fyra', 'choice.count', 'sv-SE');
    if (option.outcome !== 'apply' || quantity.outcome !== 'apply') throw new Error('unread');
    expect(toAnswer(BUILDER_GRAPH, option.reading)).toEqual({ kind: 'option', optionId: 'many' });
    expect(toAnswer(BUILDER_GRAPH, quantity.reading)).toEqual({ kind: 'quantity', value: 4 });
    expect([chipOf('T0'), chipOf('T3'), chipOf('T4'), chipOf('T7'), chipOf('T8')]).toEqual([
      'understood',
      'understood',
      'think',
      'think',
      'asked',
    ]);
  });

  it('asks rather than read a node that is not one, a language not shipped, or a wall of text', () => {
    expect(read('yes', 'no.such.node')).toMatchObject({ reason: 'not-readable' });
    expect(read('yes', 'choice.buttons', 'pt-BR')).toMatchObject({ reason: 'not-readable' });
    expect(read('menu', 'menu.top')).toMatchObject({ reason: 'not-readable' });
    expect(read('yes '.repeat(200), 'choice.buttons')).toMatchObject({ reason: 'too-long' });
  });
});

describe('the comparison budget', () => {
  it('runs out on a pathological input — the same way every time — and then asks', () => {
    // Every "no" is a negator whose every neighbour is compared with every keyword.
    const input = 'no '.repeat(150).trim();
    const first = interpret(input, {
      graph: BUILDER_GRAPH,
      nodeId: 'choice.shape',
      locale: 'en-GB',
    });
    expect(first).toMatchObject({ outcome: 'ask', reason: 'budget' });
    expect(
      interpret(input, { graph: BUILDER_GRAPH, nodeId: 'choice.shape', locale: 'en-GB' }),
    ).toEqual(first);
    expect(COMPARISON_BUDGET).toBe(20_000);
  });

  it('is never what decides a row of the English table', () => {
    const english = tables.find((t) => t.language === 'en')!;
    for (const row of english.rows) {
      expect(outcome(english, row)).not.toEqual({ ask: 'budget' });
    }
  });
});
