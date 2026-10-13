import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WordBlock } from '@tp/shared/api';
import {
  abstractList,
  docxBytes,
  list,
  numbered,
  numberingXml,
  paragraph,
  stylesXml,
  zipBytes,
} from './docx.fixture.js';
import { readWordBlocks } from './docx-blocks.js';
import { DocxRefused } from './refusal.js';
import { ZIP_CAPS } from './zip.js';

/**
 * The reader behind the rough Word-to-PDF (Phase 1c): what it keeps, what it counts as left out,
 * and the caps that apply to the zip while it reads.
 */

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// A 1x1 PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const drawing = (id: string) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const picture = (id: string) => `<w:p>${drawing(id)}</w:p>`;
const cell = (text: string, span = 1) =>
  `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${paragraph(text)}</w:tc>`;
const table = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => cell(c)).join('')}</w:tr>`).join('')}</w:tbl>`;
const imageRel = (id: string, target: string) =>
  `<Relationship Id="${id}" Type="${REL}/image" Target="${target}"/>`;

const STYLES = stylesXml(
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
);
const NUMBERING = numberingXml(abstractList(0, [['decimal', '%1.']]) + list(1, 0));

const body = [
  paragraph('Annual meeting', '<w:pStyle w:val="Heading1"/>'),
  paragraph('Plain with ', ''),
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> and italic</w:t></w:r></w:p>`,
  numbered('First item', 1),
  numbered('Second item', 1),
  table([
    ['Name', 'Amount'],
    ['Bolt', '12'],
  ]),
  picture('rId9'),
  paragraph('', '<w:pageBreakBefore/>'),
  paragraph('Second page'),
].join('');

const kinds = (blocks: readonly WordBlock[]) => blocks.map((block) => block.kind);

describe('readWordBlocks', () => {
  it('keeps headings, bold and italic, Word list numbers, a table, a picture and a page break', async () => {
    const { blocks, dropped } = await readWordBlocks(
      docxBytes({
        body,
        styles: STYLES,
        numbering: NUMBERING,
        relationships: imageRel('rId9', 'media/image1.png'),
        extra: [{ name: 'word/media/image1.png', data: PNG, deflate: false }],
      }),
    );
    expect(kinds(blocks)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'table',
      'image',
      'pageBreak',
      'paragraph',
    ]);
    expect(blocks[0]).toMatchObject({
      kind: 'heading',
      level: 1,
      runs: [{ text: 'Annual meeting' }],
    });
    expect(blocks[2]).toMatchObject({
      runs: [
        { text: 'bold', bold: true },
        { text: ' and italic', italic: true },
      ],
    });
    expect(blocks[3]).toMatchObject({ marker: '1.', depth: 0 });
    expect(blocks[4]).toMatchObject({ marker: '2.' });
    const grid = blocks[5];
    expect(
      grid?.kind === 'table' && grid.rows.map((r) => r.map((c) => c.paragraphs[0]?.[0]?.text)),
    ).toEqual([
      ['Name', 'Amount'],
      ['Bolt', '12'],
    ]);
    expect(blocks[6]).toMatchObject({ kind: 'image', mime: 'image/png', widthPt: 100 });
    expect(dropped).toEqual([]);
  });

  it('names every kind of part it leaves out, with how many', async () => {
    const footer = `<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Page footer text</w:t></w:r></w:p></w:ftr>`;
    const emptyHeader = footer.replace('Page footer text', '').replace(/w:ftr/g, 'w:hdr');
    const pieces = [
      paragraph('Body'),
      // A text box (and the Fallback that repeats it), a footnote mark, tracked changes, fields.
      `<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><wp:anchor><w:txbxContent>${paragraph('In a box')}</w:txbxContent></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${paragraph('In a box')}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
      `<w:p><w:r><w:t>Cited</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`,
      `<w:p><w:ins w:id="1"><w:r><w:t>added</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`,
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://example.org" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>a link</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    ].join('');
    const { blocks, dropped } = await readWordBlocks(
      docxBytes({
        body: pieces,
        sectPr: `<w:headerReference w:type="default" r:id="rId20"/><w:footerReference w:type="default" r:id="rId21"/>`,
        relationships: `<Relationship Id="rId20" Type="${REL}/header" Target="header1.xml"/><Relationship Id="rId21" Type="${REL}/footer" Target="footer1.xml"/>`,
        extra: [
          { name: 'word/header1.xml', data: emptyHeader },
          { name: 'word/footer1.xml', data: footer },
        ],
      }),
    );
    expect(dropped).toEqual([
      { kind: 'headerFooter', count: 1 }, // the empty header is not a loss
      { kind: 'textBox', count: 1 },
      { kind: 'footnote', count: 1 },
      { kind: 'trackedChange', count: 2 },
      { kind: 'field', count: 1 }, // the hyperlink's text is kept, so it is not counted
    ]);
    const text = JSON.stringify(blocks);
    expect(text).toContain('added');
    expect(text).toContain('a link');
    expect(text).not.toContain('gone');
    expect(text).not.toContain('In a box');
    expect(text).not.toContain('Page footer text');
  });

  it('counts a picture it cannot carry, and keeps none of an oversize one', async () => {
    const emf = Uint8Array.from([1, 0, 0, 0, 0x20, 0x45, 0x4d, 0x46]);
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(PNG);
    const { blocks, dropped } = await readWordBlocks(
      docxBytes({
        body: picture('rId9') + picture('rId10') + picture('rId11'),
        relationships:
          imageRel('rId9', 'media/image1.emf') +
          imageRel('rId10', 'media/image2.png') +
          imageRel('rId11', 'media/missing.png'),
        extra: [
          { name: 'word/media/image1.emf', data: emf, deflate: false },
          { name: 'word/media/image2.png', data: big, deflate: false },
        ],
      }),
    );
    expect(blocks).toEqual([]);
    expect(dropped).toEqual([{ kind: 'image', count: 3 }]);
  });

  it('reads a real writer’s Word file from the corpus: headings, lists and tables', async () => {
    const bytes = readFileSync(
      new URL('../../../../../../fixtures/documents/enkat-rutnat.docx', import.meta.url),
    );
    const { blocks } = await readWordBlocks(new Uint8Array(bytes));
    expect(kinds(blocks)).toContain('heading');
    expect(kinds(blocks)).toContain('table');
    expect(blocks.some((b) => b.kind === 'paragraph' && b.marker !== undefined)).toBe(true);
  });

  it('says so when a real Word file has a header and a footer', async () => {
    const bytes = readFileSync(
      new URL('../../../../../../fixtures/documents/medlemsansokan.docx', import.meta.url),
    );
    const { dropped } = await readWordBlocks(new Uint8Array(bytes));
    expect(dropped).toEqual([{ kind: 'headerFooter', count: 2 }]);
  });
});

describe('readWordBlocks, given a hostile file', () => {
  it('stops inflating a zip bomb at the shared budget, pictures included', async () => {
    const zeros = new Uint8Array(ZIP_CAPS.inflated + 1024 * 1024);
    const bomb = zipBytes([
      { name: '_rels/.rels', data: '<Relationships xmlns="x"/>' },
      { name: 'word/document.xml', data: zeros },
    ]);
    expect(bomb.length).toBeLessThan(100 * 1024); // tiny on disk, ~21 MB inflated
    await expect(readWordBlocks(bomb)).rejects.toMatchObject({
      reason: 'too-complex',
      detail: 'inflated size',
    });

    // The same budget is shared with the pictures: a document cannot spend it twice.
    const each = new Uint8Array(ZIP_CAPS.inflated / 2 + 1024);
    each.set(PNG);
    const pictures = docxBytes({
      body: picture('rId9') + picture('rId10'),
      relationships: imageRel('rId9', 'media/a.png') + imageRel('rId10', 'media/b.png'),
      extra: [
        { name: 'word/media/a.png', data: each },
        { name: 'word/media/b.png', data: each },
      ],
    });
    await expect(readWordBlocks(pictures)).rejects.toBeInstanceOf(DocxRefused);
  });

  it('refuses a file over the size cap, and an encrypted or non-Word one', async () => {
    await expect(readWordBlocks(new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toMatchObject({
      reason: 'too-large',
    });
    await expect(readWordBlocks(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toMatchObject({
      reason: 'protected',
    });
    await expect(
      readWordBlocks(zipBytes([{ name: 'word/document.xml', data: '<a/>' }])),
    ).rejects.toMatchObject({ reason: 'unreadable' });
  });
});
