import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  debugSnapshot,
  enumerate,
  layoutProblems,
  parseLayoutDocument,
  parseRawDocument,
  rawProblems,
  readLayout,
  reassemble,
  segment,
  type LayoutDocument,
  type StageResult,
} from '@tp/shared/import';

/**
 * The caveat ledger's fixtures, held to the documents that promise them and to the stages that
 * must produce them.
 *
 * `docs/plan/CAVEATS.md` says every numbering and geometry trap has a fixture, and
 * `docs/plan/NUMBERING-RULES.md` says every rule has one. Both are sentences, and a sentence nobody
 * checks drifts: a row gets added without its fixture, a fixture gets renamed, a hand-written
 * layout document gets a word whose offset no longer points at it. This test is the check.
 *
 * A fixture's `status` is a promise this file keeps. `green` means its stage runs here and its
 * output is compared, whole, with the expectation — and its debug artifact with the snapshot in
 * `fixtures/numbering/debug/`; a fixture marked green whose stage nothing runs fails. `todo` means
 * the expectation is registered as `todo`, so a run reports how many are still owed rather than
 * passing silently: a skipped expectation that prints as a pass is the defect `CLAUDE.md` ("Never
 * mistake a proxy for the thing") exists to prevent.
 */

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NUMBERING = join(ROOT, 'fixtures', 'numbering');
const DEBUG = join(NUMBERING, 'debug');
const SAMPLES = join(ROOT, 'fixtures', 'ir');

const STAGES = ['reassemble', 'enumerate', 'segment', 'classify', 'score'] as const;
type Stage = (typeof STAGES)[number];
const EXPECT_KEYS: Record<Stage, string[]> = {
  reassemble: ['reassemble', 'enumerateSummary'],
  enumerate: ['enumerate'],
  segment: ['segment'],
  classify: ['classify'],
  score: ['score', 'enumerateSummary'],
};

/**
 * What a reassemble fixture expects of a layout document: its lines in reading order with their
 * column and role, and every repair (`fixtures/numbering/*.expected.json`, `reassemble`).
 */
function reassembleSummary(doc: LayoutDocument) {
  const blocks = doc.pages.flatMap((page) => page.blocks);
  return {
    lines: blocks.flatMap((block) =>
      block.lines.map((line) => ({
        text: line.text,
        pageNo: line.pageNo,
        columnIndex: line.columnIndex,
        role: block.role,
      })),
    ),
    repairs: blocks.flatMap((block) =>
      block.lines.flatMap((line) =>
        line.words.flatMap((word) =>
          word.repair ? [{ word: word.text, kind: word.repair.kind, raw: word.repair.raw }] : [],
        ),
      ),
    ),
  };
}

/** What the fixtures' `enumerateSummary` holds of each item. */
function enumerateSummary(doc: LayoutDocument) {
  return enumerate(doc).output.items.map((item) => ({
    raw: item.marker.raw,
    label: item.label,
    level: item.level,
    verdict: item.verdict,
  }));
}

/**
 * The stages that exist, by the name a fixture gives them. A stage joins when its slice lands.
 * A stage's output must itself be valid: the reassembled document passes the IR validator, and
 * its expectation is the summary above; `also` is what the fixture expects of later stages.
 */
const RUNNERS: Partial<
  Record<
    Stage,
    (
      input: unknown,
    ) => StageResult<unknown> & { also?: Record<string, unknown>; problems?: string[] }
  >
> = {
  enumerate: (input) => enumerate(parseLayoutDocument(input)),
  segment: (input) => {
    const layout = parseLayoutDocument(input);
    return segment(layout, enumerate(layout).output);
  },
  // What a score fixture expects of each question: its lines, its label, and the strictest cap
  // on its bucket when one applies (`ocr-noise-budget`).
  score: (input) => {
    const layout = parseLayoutDocument(input);
    const read = readLayout(layout);
    const items = read.scored.scored.flatMap((scored) => {
      const segment = read.segments.segments[scored.segmentIndex]!;
      if (segment.kind !== 'question') return [];
      const caps = scored.caps.map((cap) => cap.bucketAtMost);
      const strictest = caps.includes('review') ? 'review' : caps.includes('flag') ? 'flag' : null;
      return [
        {
          lineIds: segment.lineIds,
          label: segment.label,
          ...(strictest ? { bucketAtMost: strictest } : {}),
        },
      ];
    });
    return {
      output: { items },
      debug: read.debug.find((debug) => debug.stage === 'score')!,
      also: { enumerateSummary: enumerateSummary(layout) },
    };
  },
  reassemble: (input) => {
    const { output, debug } = reassemble(parseRawDocument(input));
    return {
      output: reassembleSummary(output),
      debug,
      also: { enumerateSummary: enumerateSummary(output) },
      problems: layoutProblems(output),
    };
  },
};

interface Fixture {
  fixture: string;
  caveats: string[];
  stage: Stage;
  status: 'todo' | 'green';
  turnsGreenIn: string;
  summary: string;
  input: unknown;
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const fixtureNames = readdirSync(NUMBERING)
  .filter((name) => name.endsWith('.json') && !name.endsWith('.expected.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

const fixtures = fixtureNames.map((name) => ({
  name,
  fixture: read<Fixture>(join(NUMBERING, `${name}.json`)),
  expected: read<{ fixture: string; expect: Record<string, unknown> }>(
    join(NUMBERING, `${name}.expected.json`),
  ),
}));

/** Ids of every line in a layout document, for checking what an expectation refers to. */
function lineIds(doc: unknown): Set<string> {
  return new Set(
    parseLayoutDocument(doc).pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.lines.map((line) => line.id)),
    ),
  );
}

/** `| # | \`id\` | … | test |` rows of a section of CAVEATS.md, with the fixtures their test names. */
function ledgerRows(markdown: string) {
  return [...markdown.matchAll(/^\| (\d+) \| `([a-z0-9-]+)` \|.*\|([^|]*)\|\s*$/gm)].map((m) => ({
    number: Number(m[1]),
    id: m[2]!,
    fixtures: [...m[3]!.matchAll(/`fixtures\/numbering\/([a-z0-9-]+)\.json`/g)].map((f) => f[1]!),
  }));
}

describe('the numbering fixtures', () => {
  it('exist, in pairs', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(21);
    for (const name of fixtureNames) {
      expect(existsSync(join(NUMBERING, `${name}.expected.json`)), name).toBe(true);
    }
  });

  it.each(fixtures)('$name is well-formed', ({ name, fixture, expected }) => {
    expect(fixture.fixture).toBe(name);
    expect(expected.fixture).toBe(name);
    expect(STAGES).toContain(fixture.stage);
    expect(['todo', 'green']).toContain(fixture.status);
    expect(fixture.turnsGreenIn).toMatch(/^S\d+b?$/);
    expect(fixture.summary.length).toBeGreaterThan(20);
    expect(
      Object.keys(expected.expect).every((key) => EXPECT_KEYS[fixture.stage].includes(key)),
    ).toBe(true);
    const problems =
      fixture.stage === 'reassemble' ? rawProblems(fixture.input) : layoutProblems(fixture.input);
    expect(problems).toEqual([]);
  });

  it.each(fixtures.filter((f) => f.fixture.stage === 'enumerate'))(
    '$name expects only lines it has',
    ({ fixture, expected }) => {
      const known = lineIds(fixture.input);
      const referenced = JSON.stringify(expected.expect).match(/p\d+-l\d+/g) ?? [];
      expect(referenced.filter((id) => !known.has(id))).toEqual([]);
    },
  );

  for (const { name, fixture, expected } of fixtures) {
    const title = `${name}: the ${fixture.stage} stage produces the expected output`;
    if (fixture.status === 'todo') {
      it.todo(`${title} (${fixture.turnsGreenIn})`);
      continue;
    }
    it(title, async () => {
      const run = RUNNERS[fixture.stage];
      expect(run, `${name} is green, but nothing runs the ${fixture.stage} stage`).toBeDefined();
      const { output, debug, also = {}, problems = [] } = run!(fixture.input);
      expect(problems).toEqual([]);
      expect(output).toStrictEqual(expected.expect[fixture.stage]);
      for (const [key, value] of Object.entries(expected.expect)) {
        if (key !== fixture.stage) expect(also[key], key).toStrictEqual(value);
      }
      await expect(debugSnapshot(debug)).toMatchFileSnapshot(join(DEBUG, `${name}.json`));
    });
  }

  // A missing snapshot fails its fixture's test in CI; a snapshot left behind by a renamed or
  // demoted fixture would fail nothing, so this does.
  it('keeps no debug snapshot that no green fixture writes', () => {
    const green = new Set(
      fixtures.filter((f) => f.fixture.status === 'green').map((f) => `${f.name}.json`),
    );
    const snapshots = existsSync(DEBUG) ? readdirSync(DEBUG) : [];
    expect(snapshots.filter((name) => !green.has(name))).toEqual([]);
  });
});

describe('the IR samples', () => {
  const samples = readdirSync(SAMPLES).filter((name) => name.endsWith('.ir.json'));

  it('are the three LAYOUT-IR.md promises', () => {
    expect(samples.sort()).toEqual([
      'checkbox-grid.ir.json',
      'single-column.ir.json',
      'two-column.ir.json',
    ]);
  });

  it.each(samples)('%s is a valid layout document', (name) => {
    expect(layoutProblems(read<unknown>(join(SAMPLES, name)))).toEqual([]);
  });
});

describe('the ledger and the rules name fixtures that exist', () => {
  const caveats = readFileSync(join(ROOT, 'docs', 'plan', 'CAVEATS.md'), 'utf8');
  const rows = ledgerRows(caveats);
  const byName = new Map(fixtures.map((f) => [f.name, f.fixture]));

  it('has every row of §8.1 and §8.2, numbered 1–21, each with a fixture', () => {
    const numbered = rows.filter((row) => row.number >= 1 && row.number <= 21);
    expect(numbered.map((row) => row.number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(numbered.filter((row) => row.fixtures.length === 0).map((row) => row.id)).toEqual([]);
  });

  it.each(rows.filter((row) => row.fixtures.length > 0))(
    'row $number ($id) points at fixtures that cover it',
    ({ id, fixtures: named }) => {
      for (const name of named) {
        expect(byName.get(name)?.caveats, `${name} for ${id}`).toContain(id);
      }
    },
  );

  it('is the only place a fixture gets its caveat ids from', () => {
    const ids = new Set(rows.map((row) => row.id));
    const unknown = fixtures.flatMap((f) => f.fixture.caveats.filter((id) => !ids.has(id)));
    expect(unknown).toEqual([]);
  });

  it('gives every numbering rule a fixture that exists', () => {
    const rules = readFileSync(join(ROOT, 'docs', 'plan', 'NUMBERING-RULES.md'), 'utf8');
    const table = rules.slice(rules.indexOf('## 10. The rule table'), rules.indexOf('## 11.'));
    const rulesRows = table
      .split('\n')
      .filter((line) => /^\| [A-Z]\d+[a-z]?(?:–M9)? \|/.test(line));
    expect(rulesRows.length).toBeGreaterThanOrEqual(30);

    const missing: string[] = [];
    for (const row of rulesRows) {
      const cells = row.split('|').map((cell) => cell.trim());
      const rule = cells[1]!;
      // The last cell is the fixture column; the others hold flag names that look like fixtures.
      const fixtureCell = cells[cells.length - 2]!;
      const named = [...fixtureCell.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]!);
      if (named.length === 0 && fixtureCell !== 'every accepted list')
        missing.push(`${rule}: none`);
      for (const name of named) if (!byName.has(name)) missing.push(`${rule}: ${name}`);
    }
    expect(missing).toEqual([]);
  });
});
