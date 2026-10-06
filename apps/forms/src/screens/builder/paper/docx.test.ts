import { describe, expect, it } from 'vitest';
import { enumerate, layoutProblems, rawProblems, reassemble } from '@tp/shared/import';
import type { RawDocument } from '@tp/shared/import';
import { TooManyPages } from './extract.js';
import {
  abstractList,
  docxBytes,
  list,
  numbered,
  numberingXml,
  paragraph,
  stylesXml,
  WORDML,
  zipBytes,
} from './docx.fixture.js';
import { DOCX_EXTRACTOR, formatCounter, MAX_DOCX_BYTES, readDocx } from './docx.js';
import { DocxRefused } from './refusal.js';
import { parseXml, XML_MAX_DEPTH } from './xml.js';
import { openZip, ZIP_CAPS } from './zip.js';

/**
 * Stage 1 for Word documents — `IMPORT-PIPELINE.md` §1, DOCX, and `CAVEATS.md` #53
 * (`untrusted-docx`): Word's paragraphs, tables and own numbering as a raw document, and every cap
 * refused while reading, never after.
 */

const lines = (raw: RawDocument) =>
  raw.pages.flatMap((page) => {
    const byParagraph = new Map<number, string[]>();
    for (const word of page.words) {
      const at = byParagraph.get(word.paragraph ?? -1) ?? [];
      at.push(word.text);
      byParagraph.set(word.paragraph ?? -1, at);
    }
    return [...byParagraph.values()].map((words) => words.join(' '));
  });

const markers = (raw: RawDocument) =>
  raw.pages.flatMap((page) =>
    page.words.flatMap((w) => (w.docxNumbering ? [w.docxNumbering.rendered] : [])),
  );

async function refusal(promise: Promise<unknown>): Promise<[string, string]> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DocxRefused) return [error.reason, error.detail];
    throw error;
  }
  throw new Error('was read');
}

describe('a Word document', () => {
  it('is its paragraphs in order, a valid raw document, one paragraph a line', async () => {
    const raw = await readDocx(
      docxBytes({
        body: [
          paragraph('ANMÄLAN', '', '<w:b/><w:sz w:val="32"/>'),
          paragraph(''),
          paragraph('Namn:\t________'),
          paragraph('Indragen', '<w:ind w:left="720"/>'),
        ].join(''),
      }),
    );
    expect(rawProblems(raw)).toEqual([]);
    expect(raw.source).toMatchObject({ kind: 'docx', extractor: DOCX_EXTRACTOR });
    expect(raw.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lines(raw)).toEqual(['ANMÄLAN', 'Namn: ________', 'Indragen']);
    const [title, label, blank, indented] = raw.pages[0]!.words;
    // 16 pt is 190 iu of an A4 page's height; bold is 700.
    expect(title).toMatchObject({ fontSize: 190, fontWeight: 700, baseline: 1000, paragraph: 0 });
    // The empty paragraph still takes its line, so the next is two pitches down.
    expect(label).toMatchObject({ baseline: 1360, box: { x0: 1000 } });
    // A tab goes to the next stop, every 368 iu from the paragraph's start.
    expect(blank!.box.x0).toBe(1000 + 2 * 368);
    // 720 twips is 605 iu of an A4 width.
    expect(indented!.box.x0).toBe(1605);
  });

  it('starts a new page after the forty-fifth line, and at a page break', async () => {
    const many = Array.from({ length: 46 }, (_, i) => paragraph(`Rad ${i + 1}`)).join('');
    const raw = await readDocx(docxBytes({ body: many }));
    expect(raw.pages.map((page) => new Set(page.words.map((w) => w.paragraph)).size)).toEqual([
      45, 1,
    ]);
    const broken = await readDocx(
      docxBytes({ body: paragraph('Ett') + paragraph('Två', '<w:pageBreakBefore/>') }),
    );
    expect(broken.pages.map((page) => page.words.map((w) => w.text))).toEqual([['Ett'], ['Två']]);
  });

  it('refuses more pages than a paper form may have', async () => {
    const body = Array.from({ length: 45 * 20 + 1 }, () => paragraph('x')).join('');
    await expect(readDocx(docxBytes({ body }))).rejects.toBeInstanceOf(TooManyPages);
  });

  it('reads what Word shows: field results, not codes; no hidden or deleted text; links', async () => {
    const body = `<w:p>
      <w:r><w:t xml:space="preserve">Datum: </w:t></w:r>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE \\@ "yyyy" </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2026</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
      <w:r><w:rPr><w:vanish/></w:rPr><w:t>dold</w:t></w:r>
      <w:del><w:r><w:delText>struken</w:delText></w:r></w:del>
      <w:hyperlink><w:r><w:t xml:space="preserve"> läs mer</w:t></w:r></w:hyperlink>
    </w:p>`;
    expect(lines(await readDocx(docxBytes({ body })))).toEqual(['Datum: 2026 läs mer']);
  });

  it('gives Wingdings boxes and Symbol bullets their Unicode selves', async () => {
    const body = `<w:p><w:r><w:sym w:font="Wingdings" w:char="F0A8"/><w:t xml:space="preserve"> Ja </w:t><w:sym w:font="Wingdings" w:char="F0FE"/><w:t xml:space="preserve"> Nej</w:t></w:r></w:p>`;
    expect(lines(await readDocx(docxBytes({ body })))).toEqual(['◻ Ja ☑ Nej']);
  });

  it('puts a table cell on each of its lines, row by row', async () => {
    const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
    const body = `<w:tbl><w:tr>${cell('Namn')}${cell('Datum')}</w:tr><w:tr>${cell('Anna')}${cell('')}</w:tr></w:tbl>`;
    const raw = await readDocx(docxBytes({ body }));
    expect(raw.pages[0]!.words.map((w) => [w.text, w.cell])).toEqual([
      ['Namn', { row: 0, col: 0 }],
      ['Datum', { row: 0, col: 1 }],
      ['Anna', { row: 1, col: 0 }],
    ]);
  });

  it('finds the main part where the package says it is', async () => {
    const bytes = zipBytes([
      {
        name: '_rels/.rels',
        data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/main.xml"/></Relationships>`,
      },
      {
        name: 'word/main.xml',
        data: `<x:document xmlns:x="${WORDML}"><x:body><x:p><x:r><x:t>Hej</x:t></x:r></x:p></x:body></x:document>`,
      },
    ]);
    expect(lines(await readDocx(bytes))).toEqual(['Hej']);
  });
});

describe("Word's own numbering", () => {
  const decimalAndLetters = abstractList(0, [
    ['decimal', '%1.'],
    ['lowerLetter', '%2)'],
    ['lowerRoman', '%3.'],
  ]);

  it('is counted as Word counts, level by level, a deeper level restarting under each item', async () => {
    const raw = await readDocx(
      docxBytes({
        body: [
          numbered('Namn', 1),
          numbered('Kontakt', 1),
          numbered('Telefon', 1, 1),
          numbered('E-post', 1, 1),
          numbered('Detalj', 1, 2),
          numbered('Övrigt', 1),
          numbered('Ny', 1, 1),
        ].join(''),
        numbering: numberingXml(decimalAndLetters + list(1, 0)),
      }),
    );
    expect(markers(raw)).toEqual(['1.', '2.', 'a)', 'b)', 'i.', '3.', 'a)']);
    // The marker is Word's, not the text's; the words start at the level's text indent.
    expect(raw.pages[0]!.words[0]).toMatchObject({
      text: 'Namn',
      docxNumbering: { numId: 1, ilvl: 0, rendered: '1.', format: 'decimal' },
      box: { x0: 1605 },
    });
  });

  it('continues across lists of one definition, and restarts where a list says so', async () => {
    const raw = await readDocx(
      docxBytes({
        body: [numbered('a', 1), numbered('b', 1), numbered('c', 2), numbered('d', 3)].join(''),
        numbering: numberingXml(
          decimalAndLetters +
            list(1, 0) +
            list(2, 0) +
            list(3, 0, '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>'),
        ),
      }),
    );
    expect(markers(raw)).toEqual(['1.', '2.', '3.', '1.']);
  });

  it('writes dotted paths, legal numbering, a level that never restarts, and bullets', async () => {
    const outline = abstractList(0, [
      ['decimal', '%1.'],
      ['decimal', '%1.%2.'],
      ['lowerRoman', '%1.%2.%3', '<w:isLgl/>'],
    ]);
    const running = abstractList(1, [
      ['decimal', '%1.'],
      ['decimal', '(%2)', '<w:lvlRestart w:val="0"/>'],
    ]);
    const bullets = abstractList(2, [['bullet', '\uF0B7']]);
    const raw = await readDocx(
      docxBytes({
        body: [
          numbered('A', 1),
          numbered('A1', 1, 1),
          numbered('A1x', 1, 2),
          numbered('B', 1),
          numbered('B1', 1, 1),
          numbered('R', 2),
          numbered('R1', 2, 1),
          numbered('S', 2),
          numbered('S1', 2, 1),
          numbered('Kaffe', 3),
        ].join(''),
        numbering: numberingXml(outline + running + bullets + list(1, 0) + list(2, 1) + list(3, 2)),
      }),
    );
    expect(markers(raw)).toEqual([
      '1.',
      '1.1.',
      '1.1.1',
      '2.',
      '2.1.',
      '1.',
      '(1)',
      '2.',
      '(2)',
      '•',
    ]);
  });

  it('restarts a level only after the level its lvlRestart names', async () => {
    // Level 3 restarts after level 1 only: a new level-2 item does not restart it, a level-1 one does.
    const partial = abstractList(0, [
      ['decimal', '%1.'],
      ['lowerLetter', '%2)'],
      ['lowerRoman', '%3.', '<w:lvlRestart w:val="1"/>'],
    ]);
    const raw = await readDocx(
      docxBytes({
        body: [
          numbered('A', 1),
          numbered('Aa', 1, 1),
          numbered('Aa-i', 1, 2),
          numbered('Ab', 1, 1),
          numbered('Ab-ii', 1, 2),
          numbered('B', 1),
          numbered('Ba', 1, 1),
          numbered('Ba-i', 1, 2),
        ].join(''),
        numbering: numberingXml(partial + list(1, 0)),
      }),
    );
    expect(markers(raw)).toEqual(['1.', 'a)', 'i.', 'b)', 'ii.', '2.', 'a)', 'i.']);
  });

  it('counts an empty numbered paragraph, and draws nothing for a level Word draws nothing for', async () => {
    const quiet = abstractList(0, [['none', '']]);
    const raw = await readDocx(
      docxBytes({
        body: [numbered('Ett', 1), numbered('', 1), numbered('Tre', 1), numbered('Tyst', 2)].join(
          '',
        ),
        numbering: numberingXml(
          abstractList(1, [['decimal', '%1.']]) + quiet + list(1, 1) + list(2, 0),
        ),
      }),
    );
    expect(markers(raw)).toEqual(['1.', '3.']);
    expect(lines(raw)).toEqual(['Ett', 'Tre', 'Tyst']);
  });

  it('comes from a paragraph style, as a heading numbered by its style does', async () => {
    const styles = stylesXml(
      `<w:style w:type="paragraph" w:styleId="Rubrik1"><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr><w:rPr><w:b/></w:rPr></w:style>`,
    );
    const raw = await readDocx(
      docxBytes({
        body: paragraph('Personuppgifter', '<w:pStyle w:val="Rubrik1"/>'),
        styles,
        numbering: numberingXml(abstractList(0, [['upperRoman', '%1.']]) + list(5, 0)),
      }),
    );
    expect(raw.pages[0]!.words[0]).toMatchObject({
      fontWeight: 700,
      docxNumbering: { rendered: 'I.', format: 'upperRoman' },
    });
  });

  it.each([
    [1, 'decimal', '1'],
    [7, 'decimalZero', '07'],
    [14, 'lowerRoman', 'xiv'],
    [27, 'lowerLetter', 'aa'],
    [3, 'upperLetter', 'C'],
    [2, 'russianLower', 'б'],
    [22, 'ordinal', '22nd'],
    [12, 'ordinal', '12th'],
    [21, 'chineseCounting', '二十一'],
    [305, 'ideographDigital', '三〇五'],
    [4, 'decimalFullWidth', '４'],
    [9, 'someFutureFormat', '9'],
  ])('writes %i in %s as %s', (n, format, written) => {
    expect(formatCounter(n, format)).toBe(written);
  });

  it('reaches the list-number detector as fact, through the layout stage', async () => {
    const raw = await readDocx(
      docxBytes({
        body: [
          numbered('Namn', 1),
          numbered('3.5 miljoner – rimligt?', 1),
          paragraph('4. Övrigt'),
        ].join(''),
        numbering: numberingXml(abstractList(0, [['decimal', '%1.']]) + list(1, 0)),
      }),
    );
    const layout = reassemble(raw).output;
    expect(layoutProblems(layout)).toEqual([]);
    const items = enumerate(layout).output.items;
    expect(items.map((i) => [i.marker.raw, i.label, i.decidedBy])).toEqual([
      ['1.', 'Namn', 'W1'],
      ['2.', '3.5 miljoner – rimligt?', 'W1'],
      ['4.', 'Övrigt', 'D3'],
    ]);
  });
});

describe('an untrusted document (CAVEATS #53)', () => {
  it('is refused past 10 MB before it is opened', async () => {
    expect(await refusal(readDocx(new Uint8Array(MAX_DOCX_BYTES + 1)))).toEqual([
      'too-large',
      'file size',
    ]);
  });

  it('stops inflating a zip bomb at the budget, whatever the file claims', async () => {
    // 30 MB of zeros deflates to a few kilobytes; the file is small, the inflated document is not.
    const zeros = zipBytes([
      { name: '_rels/.rels', data: '<Relationships xmlns="x"/>' },
      { name: 'word/document.xml', data: new Uint8Array(30 * 1024 * 1024) },
    ]);
    expect(zeros.length).toBeLessThan(100_000);
    expect(await refusal(readDocx(zeros))).toEqual(['too-complex', 'inflated size']);
  });

  it('is refused with more than 200 entries, even when it says fewer', async () => {
    const entries = Array.from({ length: ZIP_CAPS.entries + 1 }, (_, i) => ({
      name: `f${i}.xml`,
      data: '<a/>',
    }));
    const honest = zipBytes(entries);
    expect(() => openZip(honest)).toThrow(DocxRefused);
    // The same archive with its end record claiming one entry: counted as they are walked.
    const lying = honest.slice();
    const view = new DataView(lying.buffer);
    view.setUint16(lying.length - 22 + 8, 1, true);
    view.setUint16(lying.length - 22 + 10, 1, true);
    expect(() => openZip(lying)).toThrow(/entries/);
  });

  it.each([
    ['a DOCTYPE', '<!DOCTYPE w:document [<!ENTITY a "aaaaaaaaaa">]><w:document/>'],
    ['an ENTITY', '<w:document><!ENTITY x SYSTEM "file:///etc/passwd"></w:document>'],
    ['a lower-case doctype', '<!doctype html><w:document/>'],
  ])('refuses %s outright, before reading anything', (_what, xml) => {
    expect(() => parseXml(xml)).toThrow(expect.objectContaining({ reason: 'unsafe' }));
  });

  it('refuses the billion laughs in a whole document', async () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]><w:document xmlns:w="${WORDML}"><w:body><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>`;
    const bytes = zipBytes([{ name: 'word/document.xml', data: laughs }]);
    expect((await refusal(readDocx(bytes)))[0]).toBe('unsafe');
  });

  it('refuses nesting deeper than the cap, and knows no entity but the five', () => {
    const deep = `${'<a>'.repeat(XML_MAX_DEPTH + 1)}${'</a>'.repeat(XML_MAX_DEPTH + 1)}`;
    expect(() => parseXml(deep)).toThrow(expect.objectContaining({ reason: 'too-complex' }));
    expect(() =>
      parseXml(`${'<a>'.repeat(XML_MAX_DEPTH)}${'</a>'.repeat(XML_MAX_DEPTH)}`),
    ).not.toThrow();
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(
      expect.objectContaining({ reason: 'unreadable' }),
    );
    expect(parseXml('<a b="&lt;&#x263A;&#9731;">&amp;<![CDATA[<x>]]></a>')).toMatchObject({
      attrs: { b: '<☺☃' },
      children: ['&', '<x>'],
    });
  });

  it('is refused when encrypted, zipped another way, not a zip, or not WordprocessingML', async () => {
    const encrypted = zipBytes([{ name: 'word/document.xml', data: '<a/>', encrypted: true }]);
    expect((await refusal(readDocx(encrypted)))[0]).toBe('protected');
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect((await refusal(readDocx(ole)))[0]).toBe('protected');
    const bzip = zipBytes([
      { name: 'word/document.xml', data: '<a/>', deflate: false, method: 12 },
    ]);
    expect(await refusal(readDocx(bzip))).toEqual(['unreadable', 'compression method 12']);
    expect((await refusal(readDocx(new TextEncoder().encode('hello'))))[0]).toBe('unreadable');
    const html = zipBytes([{ name: 'word/document.xml', data: '<html><body/></html>' }]);
    expect((await refusal(readDocx(html)))[0]).toBe('unreadable');
    const broken = zipBytes([
      { name: 'word/document.xml', data: '<w:document><w:body></w:document>' },
    ]);
    expect((await refusal(readDocx(broken)))[0]).toBe('unreadable');
  });

  it('reads stored and deflated entries alike', async () => {
    const xml = `<w:document xmlns:w="${WORDML}"><w:body>${paragraph('Hej')}</w:body></w:document>`;
    for (const deflate of [true, false]) {
      const bytes = zipBytes([{ name: 'word/document.xml', data: xml, deflate }]);
      expect(lines(await readDocx(bytes))).toEqual(['Hej']);
    }
  });
});
