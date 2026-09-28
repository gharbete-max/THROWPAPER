import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../debug.js';
import { enumerate } from '../enumerate/enumerate.js';
import type { Box, DocxNumbering, IrSource, RawDocument, RawWord } from '../ir/types.js';
import { layoutProblems } from '../ir/validate.js';
import { IrError } from '../ir/validate.js';
import { isBlankWord, isCheckboxWord, textHints } from './hints.js';
import {
  documentLocale,
  furnitureKey,
  isConjunction,
  isPageNumberKey,
  LAYOUT_LANGUAGES,
  LAYOUT_LEXICON,
} from './lexicon.js';
import { PROSE } from './prose.fixture.js';
import { reassemble } from './reassemble.js';
import { columnRegions, MAX_CUT_DEPTH } from './xycut.js';

/**
 * Stage 2 — `IMPORT-PIPELINE.md` §2. The fixtures in `fixtures/numbering/` hold each rule to a
 * document (`scripts/caveat-fixtures.test.ts`); these hold the stage to what every output must
 * be — valid, the same every time, ordered by geometry and never by the order words came in — and
 * test the pieces the fixtures reach only once.
 */

/** A word in the fixtures' synthetic metrics: 92 iu a character, 105 above the baseline, 26 below. */
function word(
  text: string,
  x0: number,
  baseline: number,
  more: Partial<RawWord> & { size?: number } = {},
): RawWord {
  const { size = 131, ...rest } = more;
  return {
    text,
    box: {
      x0,
      y0: baseline - Math.round((size * 105) / 131),
      x1: x0 + 92 * [...text].length,
      y1: baseline + Math.round((size * 26) / 131),
    },
    baseline,
    fontSize: size,
    fontWeight: 400,
    italic: false,
    ocrConfidence: null,
    repair: null,
    source: 'text-layer',
    paragraph: null,
    docxNumbering: null,
    cell: null,
    ...rest,
  };
}

/** A line of words from x0, one space (92 iu) between them. */
function line(
  text: string,
  x0: number,
  baseline: number,
  more: Partial<RawWord> & { size?: number } = {},
): RawWord[] {
  const out: RawWord[] = [];
  let x = x0;
  for (const piece of text.split(' ')) {
    out.push(word(piece, x, baseline, more));
    x += 92 * ([...piece].length + 1);
  }
  return out;
}

function doc(pages: RawWord[][], rules: Box[][] = [], kind: 'pdf' | 'docx' = 'pdf'): RawDocument {
  return {
    irVersion: 1,
    source: { kind, extractor: 'test', sha256: null },
    pages: pages.map((words, i) => ({
      pageNo: i + 1,
      widthPt: 595,
      heightPt: 842,
      words,
      rules: rules[i] ?? [],
    })),
  };
}

const texts = (raw: RawDocument) =>
  reassemble(raw).output.pages.flatMap((page) =>
    page.blocks.flatMap((block) => block.lines.map((l) => l.text)),
  );

/** A seeded linear congruential generator: the same page every run, no `Math.random`. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % n;
  };
}

/** A page of one or two columns of short lines, with a heading, from a seed. */
function randomPage(seed: number): RawWord[] {
  const next = seeded(seed);
  const vocabulary = ['Namn', 'adress', 'och', 'e-post', '1.', '2.', 'a)', '____', '☐', 'Ja'];
  const columns = next(2) + 1;
  const words: RawWord[] = line('ANMÄLAN', 1000, 800, { fontWeight: 700 });
  for (let c = 0; c < columns; c += 1) {
    const x0 = c === 0 ? 1000 : 5400;
    let baseline = 1300 + next(3) * 180;
    for (let l = 0; l < 6 + next(12); l += 1) {
      const count = 1 + next(4);
      const text = Array.from({ length: count }, () => vocabulary[next(vocabulary.length)]).join(
        ' ',
      );
      words.push(...line(text, x0 + next(3) * 368, baseline));
      baseline += next(4) === 0 ? 360 : 180;
    }
  }
  return words;
}

describe('stage 2, reassemble', () => {
  it('always gives a valid layout document, whatever the page', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const raw = doc([randomPage(seed), randomPage(seed * 7)]);
      expect(layoutProblems(reassemble(raw).output), `seed ${seed}`).toEqual([]);
    }
  });

  it('reads by geometry: the order words arrive in changes nothing', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const words = randomPage(seed);
      const shuffle = seeded(seed + 1000);
      const shuffled = [...words];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = shuffle(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(canonicalJson(reassemble(doc([shuffled])).output)).toBe(
        canonicalJson(reassemble(doc([words])).output),
      );
    }
  });

  it('gives the same bytes twice, and does not touch its input', () => {
    const raw = doc([randomPage(3)]);
    const before = canonicalJson(raw);
    const first = reassemble(raw);
    expect(canonicalJson(reassemble(raw))).toBe(canonicalJson(first));
    expect(canonicalJson(raw)).toBe(before);
  });

  it('keeps a page with no words, and never mixes measured and synthetic words on one', () => {
    const result = reassemble(doc([[], line('Namn', 1000, 1000)]));
    expect(result.output.pages.map((p) => p.blocks.length)).toEqual([0, 1]);
    expect(layoutProblems(result.output)).toEqual([]);
    const mixed = [
      ...line('Namn', 1000, 1000),
      word('Adress', 1000, 1180, { source: 'paste', paragraph: 1 }),
    ];
    expect(() => reassemble(doc([mixed]))).toThrow(IrError);
  });
});

describe('§2.1 ligatures', () => {
  it('are expanded, and a later join keeps the ligature in the raw text', () => {
    const long =
      'Everyone who wants to come must fill in the form and send it to the club before the \uFB01n-';
    const out = reassemble(doc([[...line(long, 1000, 1000), ...line('ished date.', 1000, 1180)]]));
    const words = out.output.pages[0]!.blocks[0]!.lines[0]!.words;
    expect(words.at(-1)).toMatchObject({
      text: 'finished',
      repair: { kind: 'dehyphenated', raw: '\uFB01n-\nished' },
    });
  });
});

describe('§2.2 column regions', () => {
  it('cuts two columns side by side and reads the left one first', () => {
    const left = [...line('1. Namn', 1000, 1000), ...line('2. Adress', 1000, 1180)];
    const right = [...line('3. Telefon', 5400, 1000), ...line('4. E-post', 5400, 1180)];
    expect(texts(doc([[...right, ...left]]))).toEqual([
      '1. Namn',
      '2. Adress',
      '3. Telefon',
      '4. E-post',
    ]);
  });

  it('gives a column the page width mirrored from its left margin, not its longest line', () => {
    const out = reassemble(doc([line('Kort rad.', 1200, 1000)])).output;
    expect(out.pages[0]!.columns[0]).toMatchObject({ x0: 1200, x1: 8800 });
  });

  it('peels a row of gutters one cut at a time, and stops at its depth bound with every word', () => {
    // Thirty words on one line, each 200 iu from the next: every gutter is a cut, leftmost first.
    const words = Array.from({ length: 30 }, (_, i) => word('x', 1000 + i * 292, 1000));
    expect(columnRegions(words, () => {}).map((r) => r.words.length)).toEqual(
      Array.from({ length: 30 }, () => 1),
    );
    const bounded = columnRegions(words, () => {}, 5);
    expect(bounded.map((r) => r.words.length)).toEqual([1, 1, 1, 1, 1, 25]);
    expect(MAX_CUT_DEPTH).toBeGreaterThan(words.length);
  });
});

describe('§2.3–§2.5 lines and blocks', () => {
  it('puts a raised word on its line, and a line from another source on its own', () => {
    const words = [
      ...line('Allergier', 1000, 1000),
      word('1', 1920, 960, { size: 80 }),
      word('Övrigt', 1000, 1000, { source: 'ocr', ocrConfidence: 71 }),
    ];
    const lines = reassemble(doc([words])).output.pages[0]!.blocks.flatMap((b) => b.lines);
    expect(lines.map((l) => [l.text, l.source, l.ocrConfidence])).toEqual([
      ['Allergier 1', 'text-layer', null],
      ['Övrigt', 'ocr', 71],
    ]);
  });
});

describe('§2.4 hyphenation', () => {
  const long = 'Alla deltagare som vill vara med på middagen efter årsmötet ska fylla i sin regis-';
  it('joins a word broken across lines, and keeps an OCR confidence as the lower of the two', () => {
    const words = [
      ...line(long, 1000, 1000, { source: 'ocr', ocrConfidence: 90 }),
      ...line('trering före fredag.', 1000, 1180, { source: 'ocr', ocrConfidence: 62 }),
    ];
    const [first] = reassemble(doc([words])).output.pages[0]!.blocks[0]!.lines;
    expect(first!.words.at(-1)).toMatchObject({ text: 'registrering', ocrConfidence: 62 });
    expect(first!.ocrConfidence).toBe(62);
  });

  it('never joins a line that was not wrapped, or a synthetic one', () => {
    const short = [...line('Kort regis-', 1000, 1000), ...line('trering.', 1000, 1180)];
    expect(texts(doc([short]))).toEqual(['Kort regis-', 'trering.']);
    const docx = [
      ...line(long, 1000, 1000, { source: 'docx', paragraph: 0 }),
      ...line('trering.', 1000, 1180, { source: 'docx', paragraph: 1 }),
    ];
    expect(texts(doc([docx], [], 'docx'))).toEqual([long, 'trering.']);
  });

  it('knows the conjunctions a suspended compound stands before, in every language', () => {
    for (const language of LAYOUT_LANGUAGES) {
      expect(LAYOUT_LEXICON.conjunctions[language].every(isConjunction), language).toBe(true);
    }
    expect(isConjunction('Och')).toBe(true);
    expect(isConjunction('tering')).toBe(false);
  });
});

describe('§2.6 page furniture', () => {
  it('folds digits and case into one key, and knows page numbers in the shipped languages', () => {
    expect(furnitureKey('  Sida 2  av 13 ')).toBe('sida # av #');
    expect(furnitureKey('第１２页')).toBe('第#页');
    for (const text of [
      '7',
      'Page 3 of 9',
      'Seite 2 von 4',
      'Страница 1 из 2',
      '第3页',
      '4ページ',
    ]) {
      expect(isPageNumberKey(furnitureKey(text)), text).toBe(true);
    }
    expect(isPageNumberKey(furnitureKey('Anmälan 2026'))).toBe(false);
    const folded = Object.values(LAYOUT_LEXICON.pageNumbers).flat();
    expect(folded.filter((key) => furnitureKey(key) !== key)).toEqual([]);
  });

  it('needs a margin line on at least two pages and at least half of them', () => {
    const page = (header: boolean) => [
      ...(header ? line('Föreningen Exempel', 1000, 500) : []),
      ...line('Text på sidan.', 1000, 1000),
    ];
    const roles = (flags: boolean[]) =>
      reassemble(doc(flags.map(page))).output.pages.map((p) => p.blocks[0]!.role);
    expect(roles([true, true, false, false])).toEqual([
      'page-furniture',
      'page-furniture',
      'body',
      'body',
    ]);
    expect(roles([true, true, false, false, false])).toEqual([
      'body',
      'body',
      'body',
      'body',
      'body',
    ]);
  });

  it('gives a column of nothing but furniture a band of its own', () => {
    const out = reassemble(doc([line('Sida 1 av 1', 1000, 9500)])).output;
    expect(out.pages[0]!.columns[0]!.bands).toEqual([1000]);
    expect(layoutProblems(out)).toEqual([]);
  });
});

describe('§2.7–§2.9 roles', () => {
  it('reads a small raised mark at the foot of the page as a footnote', () => {
    const words = [
      ...line('1. Namn', 1000, 1000),
      ...line('2. Adress', 1000, 1180),
      word('²', 1000, 8780, { size: 60 }),
      ...line('Frivilligt.', 1100, 8800, { size: 100 }),
    ];
    const roles = reassemble(doc([words])).output.pages[0]!.blocks.map((b) => b.role);
    expect(roles).toEqual(['body', 'footnote']);
  });

  it('never reads a synthetic page as having margins, a foot or furniture', () => {
    const words = [
      ...line('Sida 1 av 1', 1000, 8900, { source: 'docx', paragraph: 0, size: 100 }),
      ...line('* Frivilligt.', 1000, 9000, { source: 'docx', paragraph: 1, size: 100 }),
    ];
    const roles = reassemble(doc([words], [], 'docx')).output.pages[0]!.blocks.map((b) => b.role);
    expect(roles).toEqual(['body']);
  });

  it('gives a Word table its own block, and carries Word numbering to the line', () => {
    const numbering: DocxNumbering = { numId: 1, ilvl: 0, rendered: '1.', format: 'decimal' };
    const words = [
      word('Namn', 1000, 1000, { source: 'docx', paragraph: 0, docxNumbering: numbering }),
      word('Ja', 1000, 1180, { source: 'docx', paragraph: 1, cell: { row: 0, col: 0 } }),
      word('Nej', 1000, 1360, { source: 'docx', paragraph: 2, cell: { row: 0, col: 1 } }),
    ];
    const out = reassemble(doc([words], [], 'docx')).output;
    const blocks = out.pages[0]!.blocks;
    expect(blocks.map((b) => [b.role, b.lines.length])).toEqual([
      ['body', 1],
      ['table', 2],
    ]);
    expect(blocks[0]!.lines[0]!.hints.docxNumbering).toEqual(numbering);
    expect(blocks[1]!.lines.map((l) => l.cell)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ]);
    expect(out.pages[0]!.columns[0]).toMatchObject({ x0: 1000, x1: 9000 });
  });

  it('keeps a synthetic paragraph in its own order, even where its words are pinned together', () => {
    const pinned = (text: string) =>
      word(text, 0, 1000, {
        source: 'paste',
        paragraph: 0,
        box: { x0: 10_000, y0: 895, x1: 10_000, y1: 1026 },
      });
    const words = ['c', 'b', 'a'].map(pinned);
    expect(texts(doc([words]))).toEqual(['c b a']);
  });
});

describe('§2.10 hints', () => {
  it('knows a rule below a line only when it reaches a fifth of the column past the text', () => {
    const label = line('Namn:', 1000, 1000);
    const hint = (rule: Box, source: IrSource = 'text-layer') =>
      reassemble(
        doc(
          [label.map((w) => ({ ...w, source, ocrConfidence: source === 'ocr' ? 90 : null }))],
          [[rule]],
        ),
      ).output.pages[0]!.blocks[0]!.lines[0]!.hints.ruleBelow;
    expect(hint({ x0: 1500, y0: 1010, x1: 5000, y1: 1012 })).toBe(true);
    expect(hint({ x0: 1500, y0: 1010, x1: 2500, y1: 1012 })).toBe(false); // too short
    expect(hint({ x0: 1500, y0: 1400, x1: 5000, y1: 1402 })).toBe(false); // the next line's
    expect(hint({ x0: 1500, y0: 1010, x1: 5000, y1: 1012 }, 'ocr')).toBe(false);
  });

  it('tells a blank and a checkbox from a word, as the column cut needs', () => {
    expect(['____', '……', '.......', '___:'].every(isBlankWord)).toBe(true);
    expect(['Namn', '...', '__', 'a____'].some(isBlankWord)).toBe(false);
    expect(isCheckboxWord('☐')).toBe(true);
    expect(isCheckboxWord('☐Ja')).toBe(false);
    expect(textHints('E-post: ________').endsWithColon).toBe(true);
  });
});

describe('§2.11 the document language', () => {
  it.each(LAYOUT_LANGUAGES)('is known from a paragraph of %s', (language) => {
    expect(documentLocale([PROSE[language]]).locale).toBe(language);
  });

  it('is not guessed from a line, or from two languages at once', () => {
    expect(documentLocale(['Namn och adress']).locale).toBeNull();
    expect(documentLocale([PROSE.sv, PROSE.nb]).locale).toBeNull();
    expect(documentLocale([PROSE.da, PROSE.nb]).locale).toBeNull();
  });

  it('is read from the body, never from the page furniture', () => {
    const pages = [1, 2, 3].map((n) => [
      ...line(`Sida ${n} av 3`, 1000, 9500),
      ...line('Namn', 1000, 1000),
    ]);
    expect(reassemble(doc(pages)).output.locale).toBeNull();
  });
});

describe('Word numbering read with the rest (§11 of NUMBERING-RULES)', () => {
  it('reaches stage 3 through stage 2', () => {
    const numbering = (n: number): DocxNumbering => ({
      numId: 3,
      ilvl: 0,
      rendered: `${n}.`,
      format: 'decimal',
    });
    const words = ['Namn', 'Adress'].map((text, i) =>
      word(text, 1000, 1000 + i * 180, {
        source: 'docx',
        paragraph: i,
        docxNumbering: numbering(i + 1),
      }),
    );
    const { output } = reassemble(doc([words], [], 'docx'));
    expect(output.pages[0]!.blocks[0]!.lines.map((l) => l.hints.docxNumbering?.rendered)).toEqual([
      '1.',
      '2.',
    ]);
    expect(enumerate(output).output.items).toBeDefined();
  });
});
