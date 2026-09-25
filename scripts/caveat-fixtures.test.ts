import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The caveat ledger's fixtures, held to the documents that promise them.
 *
 * `docs/plan/CAVEATS.md` says every numbering and geometry trap has a fixture, and
 * `docs/plan/NUMBERING-RULES.md` says every rule has one. Both are sentences, and a sentence nobody
 * checks drifts: a row gets added without its fixture, a fixture gets renamed, a hand-written
 * layout document gets a word whose offset no longer points at it. This test is the check.
 *
 * It does **not** run the detector — slice S1b builds that. Each fixture's expectation is
 * registered as `todo` until its `status` says `green`, so a run reports how many are still owed
 * rather than passing silently: a skipped expectation that prints as a pass is the defect
 * `CLAUDE.md` ("Never mistake a proxy for the thing") exists to prevent.
 */

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NUMBERING = join(ROOT, 'fixtures', 'numbering');
const SAMPLES = join(ROOT, 'fixtures', 'ir');

const STAGES = ['reassemble', 'enumerate', 'segment', 'classify'] as const;
const EXPECT_KEYS: Record<(typeof STAGES)[number], string[]> = {
  reassemble: ['reassemble', 'enumerateSummary'],
  enumerate: ['enumerate'],
  segment: ['segment'],
  classify: ['classify', 'enumerateSummary'],
};
const ROLES = ['body', 'heading', 'page-furniture', 'footnote', 'table'];
const SOURCES = ['text-layer', 'ocr', 'docx', 'paste'];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Word {
  text: string;
  start?: number;
  box: Box;
  baseline: number;
  fontSize: number;
  fontWeight: number;
  ocrConfidence: number | null;
  source?: string;
}
interface Line {
  id: string;
  pageNo: number;
  columnIndex: number;
  blockId: string;
  text: string;
  words: Word[];
  box: Box;
  baseline: number;
  indentBand: number;
  source: string;
  ocrConfidence: number | null;
}
interface Block {
  id: string;
  pageNo: number;
  columnIndex: number;
  role: string;
  lines: Line[];
}
interface Column {
  x0: number;
  x1: number;
  bands: number[];
}
interface Page {
  pageNo: number;
  columns?: Column[];
  blocks?: Block[];
  words?: Word[];
}
interface IrDocument {
  irVersion: number;
  pages: Page[];
}
interface Fixture {
  fixture: string;
  caveats: string[];
  stage: (typeof STAGES)[number];
  status: 'todo' | 'green';
  turnsGreenIn: string;
  summary: string;
  input: IrDocument;
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

/** Every problem with an IR document, as sentences. An empty list is a valid document. */
function irProblems(doc: IrDocument, layout: boolean): string[] {
  const problems: string[] = [];
  const iu = (where: string, value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      problems.push(`${where}: ${value} is not an integer in [0, 10000]`);
    }
  };
  const box = (where: string, b: Box) => {
    for (const key of ['x0', 'y0', 'x1', 'y1'] as const) iu(`${where}.${key}`, b[key]);
    if (b.x0 > b.x1 || b.y0 > b.y1) problems.push(`${where}: inverted box`);
  };
  if (doc.irVersion !== 1) problems.push(`irVersion is ${doc.irVersion}, not 1`);

  const ids = new Set<string>();
  doc.pages.forEach((page, index) => {
    if (page.pageNo !== index + 1) problems.push(`page ${index} has pageNo ${page.pageNo}`);
    if (!layout) {
      for (const [i, word] of (page.words ?? []).entries()) {
        box(`p${page.pageNo} word ${i}`, word.box);
        if (!SOURCES.includes(word.source ?? ''))
          problems.push(`p${page.pageNo} word ${i}: source`);
      }
      return;
    }
    const columns = page.columns ?? [];
    for (const block of page.blocks ?? []) {
      if (!/^p\d+-b\d+$/.test(block.id) || ids.has(block.id)) problems.push(`block id ${block.id}`);
      ids.add(block.id);
      if (block.pageNo !== page.pageNo) problems.push(`${block.id}: pageNo`);
      if (!ROLES.includes(block.role)) problems.push(`${block.id}: role ${block.role}`);
      if (block.lines.length === 0) problems.push(`${block.id}: no lines`);
      let previousBaseline = -1;
      for (const line of block.lines) {
        const at = line.id;
        if (!/^p\d+-l\d+$/.test(at) || ids.has(at)) problems.push(`line id ${at}`);
        ids.add(at);
        if (line.blockId !== block.id || line.pageNo !== page.pageNo)
          problems.push(`${at}: parent`);
        if (line.columnIndex !== block.columnIndex) problems.push(`${at}: columnIndex`);
        if (!SOURCES.includes(line.source)) problems.push(`${at}: source ${line.source}`);
        if (line.baseline < previousBaseline) problems.push(`${at}: out of order in its block`);
        previousBaseline = line.baseline;
        box(at, line.box);
        if (line.words.length === 0) problems.push(`${at}: no words`);
        if (line.text !== line.words.map((word) => word.text).join(' ')) {
          problems.push(`${at}: text is not its words joined by single spaces`);
        }
        for (const word of line.words) {
          box(`${at} "${word.text}"`, word.box);
          const start = word.start ?? -1;
          if (line.text.slice(start, start + word.text.length) !== word.text) {
            problems.push(`${at}: "${word.text}" is not at offset ${start}`);
          }
          const ocr = word.ocrConfidence;
          if (line.source === 'ocr' ? !Number.isInteger(ocr) : ocr !== null) {
            problems.push(`${at}: ocrConfidence ${ocr} for source ${line.source}`);
          }
        }
        const column = columns[line.columnIndex];
        const band = column?.bands[line.indentBand];
        if (!column || band === undefined) {
          problems.push(`${at}: no column ${line.columnIndex} / band ${line.indentBand}`);
        } else if (
          block.role !== 'page-furniture' &&
          block.role !== 'footnote' &&
          (line.box.x0 < band || (line.box.x0 - band) * 50 > column.x1 - column.x0)
        ) {
          problems.push(`${at}: x0 ${line.box.x0} is not in band ${line.indentBand} (${band})`);
        }
      }
    }
  });
  return problems;
}

/** Ids of every line in a layout document, for checking what an expectation refers to. */
function lineIds(doc: IrDocument): Set<string> {
  return new Set(
    doc.pages.flatMap((page) =>
      (page.blocks ?? []).flatMap((block) => block.lines.map((line) => line.id)),
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
    expect(irProblems(fixture.input, fixture.stage !== 'reassemble')).toEqual([]);
  });

  it.each(fixtures.filter((f) => f.fixture.stage === 'enumerate'))(
    '$name expects only lines it has',
    ({ fixture, expected }) => {
      const known = lineIds(fixture.input);
      const referenced = JSON.stringify(expected.expect).match(/p\d+-l\d+/g) ?? [];
      expect(referenced.filter((id) => !known.has(id))).toEqual([]);
    },
  );

  for (const { name, fixture } of fixtures) {
    if (fixture.status === 'todo') {
      it.todo(
        `${name}: the ${fixture.stage} stage produces the expected output (${fixture.turnsGreenIn})`,
      );
    }
  }
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
    expect(irProblems(read<IrDocument>(join(SAMPLES, name)), true)).toEqual([]);
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
