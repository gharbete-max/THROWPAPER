import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { WordBlock, WordPdfRequest } from '../../packages/shared/src/api/word-pdf.js';
import { WordPdfRequest as Schema } from '../../packages/shared/src/api/word-pdf.js';
import { createPdfRenderer, type PdfRenderer } from '../../apps/api-forms/src/documents/render.js';
import { wordToPdf } from '../../apps/api-forms/src/pdf/word.js';
import { readWordBlocks } from '../../apps/forms/src/screens/builder/paper/docx-blocks.js';
import {
  abstractList,
  docxBytes,
  list,
  numbered,
  numberingXml,
  paragraph,
  stylesXml,
} from '../../apps/forms/src/screens/builder/paper/docx.fixture.js';

/**
 * Phase 1c, end to end: a Word file read by the browser's reader, sent through the request
 * schema, and drawn by the real PDF renderer (Chromium) — then the PDF's own text is read back.
 * The two halves live in two apps that may not import each other, so the join is here.
 */
let renderer: PdfRenderer;
beforeAll(() => {
  renderer = createPdfRenderer();
}, 60_000);
afterAll(async () => {
  await renderer?.close();
});

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

async function pdfOf(docx: Uint8Array) {
  const { blocks, dropped } = await readWordBlocks(docx);
  const request = Schema.parse({ blocks, lang: 'sv-SE' } satisfies WordPdfRequest);
  const pdf = await wordToPdf(renderer, request);
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  let text = '';
  let images = 0;
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    text += `${(await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')}\n`;
    const ops = await page.getOperatorList();
    images += ops.fnArray.filter((fn) => fn === OPS.paintImageXObject).length;
  }
  // Whitespace is dropped on both sides: pdf.js splits words at kerning pairs ("A ndra").
  return { text: text.replace(/\s+/g, ''), pages: doc.numPages, images, blocks, dropped };
}

describe('a Word file made into a PDF', () => {
  it('carries a heading, a list, a table and a picture, and says what a footer lost', async () => {
    const docx = docxBytes({
      body: [
        paragraph('Årsmöte 2026', '<w:pStyle w:val="Heading1"/>'),
        numbered('Öppnande av mötet', 1),
        numbered('Val av ordförande', 1),
        `<w:tbl><w:tr><w:tc>${paragraph('Post')}</w:tc><w:tc>${paragraph('Belopp')}</w:tc></w:tr><w:tr><w:tc>${paragraph('Medlemsavgift')}</w:tc><w:tc>${paragraph('250')}</w:tc></w:tr></w:tbl>`,
        `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="1270000"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
        paragraph('', '<w:pageBreakBefore/>'),
        paragraph('Andra sidan'),
      ].join(''),
      styles: stylesXml(
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
      ),
      numbering: numberingXml(abstractList(0, [['decimal', '%1.']]) + list(1, 0)),
      sectPr: '<w:footerReference w:type="default" r:id="rId21"/>',
      relationships: `<Relationship Id="rId9" Type="${REL}/image" Target="media/image1.png"/><Relationship Id="rId21" Type="${REL}/footer" Target="footer1.xml"/>`,
      extra: [
        { name: 'word/media/image1.png', data: PNG, deflate: false },
        {
          name: 'word/footer1.xml',
          data: '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Sidfot</w:t></w:r></w:p></w:ftr>',
        },
      ],
    });
    const made = await pdfOf(docx);
    for (const expected of [
      'Årsmöte 2026',
      '1.',
      'Öppnande av mötet',
      '2.',
      'Val av ordförande',
      'Post',
      'Medlemsavgift',
      '250',
      'Andra sidan',
    ]) {
      expect(made.text).toContain(expected.replace(/\s+/g, ''));
    }
    expect(made.text).not.toContain('Sidfot'); // dropped, and said so:
    expect(made.dropped).toEqual([{ kind: 'headerFooter', count: 1 }]);
    expect(made.pages).toBe(2);
    expect(made.images).toBeGreaterThan(0);
  }, 60_000);

  it('turns a real writer’s corpus files into PDFs that hold their headings, lists and cells', async () => {
    for (const name of ['enkat-rutnat', 'lagerschema']) {
      const made = await pdfOf(
        new Uint8Array(
          readFileSync(new URL(`../../fixtures/documents/${name}.docx`, import.meta.url)),
        ),
      );
      const words = (block: WordBlock): string[] => {
        if (block.kind === 'heading' || block.kind === 'paragraph') {
          return [block.runs.map((r) => r.text).join('')];
        }
        if (block.kind === 'table') {
          return block.rows.flatMap((row) =>
            row.flatMap((c) => c.paragraphs.map((p) => p.map((r) => r.text).join(''))),
          );
        }
        return [];
      };
      const wanted = made.blocks
        .flatMap(words)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => /\p{L}{3}/u.test(s));
      expect(wanted.length).toBeGreaterThan(5);
      for (const piece of wanted) {
        expect(made.text, `${name}: ${piece}`).toContain(piece.replace(/\s+/g, ''));
      }
    }
  }, 90_000);

  it('names the footer of a real Word file as left out', async () => {
    const { dropped } = await readWordBlocks(
      new Uint8Array(
        readFileSync(new URL('../../fixtures/documents/medlemsansokan.docx', import.meta.url)),
      ),
    );
    expect(dropped.map((d) => d.kind)).toEqual(['headerFooter']);
  });
});
