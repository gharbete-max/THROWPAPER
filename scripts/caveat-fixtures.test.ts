import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  enumerate,
  layoutProblems,
  parseLayoutDocument,
  rawProblems,
  type StageDebug,
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

const STAGES = ['reassemble', 'enumerate', 'segment', 'classify'] as const;
type Stage = (typeof STAGES)[number];
const EXPECT_KEYS: Record<Stage, string[]> = {
  reassemble: ['reassemble', 'enumerateSummary'],
  enumerate: ['enumerate'],
  segment: ['segment'],
  classify: ['classify', 'enumerateSummary'],
};

/** The stages that exist, by the name a fixture gives them. A stage joins when its slice lands. */
const RUNNERS: Partial<Record<Stage, (input: unknown) => StageResult<unknown>>> = {
  enumerate: (input) => enumerate(parseLayoutDocument(input)),
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

/**
 * A debug artifact as its snapshot file: the header, then one decision per line with its id first
 * and its evidence in key order — valid JSON a reviewer can read as a diff, decision by decision.
 */
function debugFile(debug: StageDebug): string {
  const decisions = debug.decisions.map(({ id, rule, verdict, subject, evidence }) =>
    JSON.stringify({
      id,
      rule,
      verdict,
      subject,
      evidence: Object.fromEntries(Object.entries(evidence).sort(([a], [b]) => (a < b ? -1 : 1))),
    }),
  );
  const header = (['stage', 'stageVersion', 'irVersion', 'inputSha256'] as const).map(
    (key) => `  ${JSON.stringify(key)}: ${JSON.stringify(debug[key])},`,
  );
  return `{\n${header.join('\n')}\n  "decisions": [\n    ${decisions.join(',\n    ')}\n  ]\n}\n`;
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
      const { output, debug } = run!(fixture.input);
      expect(output).toStrictEqual(expected.expect[fixture.stage]);
      await expect(debugFile(debug)).toMatchFileSnapshot(join(DEBUG, `${name}.json`));
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
