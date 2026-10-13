import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { OutboundMail } from '../mail/provider.js';

/**
 * The demo's own PDFs, drawn here so the committed files in `fixtures/demo/` and the message the
 * desktop demo puts in To send come from one place. Invented content throughout: an invented
 * association, an invented person, neutral prose. Standard Helvetica only (WinAnsi covers å ä ö).
 *
 * `pnpm --filter @tp/api-forms demo:fixtures` rewrites the files.
 */

const A4: [number, number] = [595, 842];

async function blank(title: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Loppa demo');
  doc.setCreator('Loppa demo');
  // Fixed, so rebuilding the fixture does not change the file.
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1)));
  doc.setModificationDate(new Date(Date.UTC(2026, 0, 1)));
  return doc;
}

export const FILLED_FORM = {
  name: 'Maja Strand',
  address: 'Björkvägen 4, 412 55 Göteborg',
  email: 'maja.strand@example.com',
  newsletter: true,
} as const;

/** A one-page membership slip with its own fields (AcroForm); `filled` writes the invented answers. */
export async function demoFormPdf(filled: boolean): Promise<Uint8Array> {
  const doc = await blank('Medlemsanmälan');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  page.drawText('Medlemsanmälan', { x: 60, y: 770, size: 22, font: bold });
  page.drawText('Trädgårdsföreningen Exempel', { x: 60, y: 745, size: 12, font });
  const form = doc.getForm();
  const rows = [
    ['name', 'Namn'],
    ['address', 'Adress'],
    ['email', 'E-post'],
  ] as const;
  rows.forEach(([key, label], index) => {
    const y = 690 - index * 60;
    page.drawText(label, { x: 60, y: y + 28, size: 11, font });
    const field = form.createTextField(key);
    field.addToPage(page, { x: 60, y, width: 470, height: 24, font });
    if (filled) field.setText(FILLED_FORM[key]);
  });
  const box = form.createCheckBox('newsletter');
  box.addToPage(page, { x: 60, y: 490, width: 16, height: 16 });
  page.drawText('Jag vill ha föreningens nyhetsbrev.', { x: 86, y: 493, size: 11, font });
  if (filled && FILLED_FORM.newsletter) box.check();
  form.updateFieldAppearances(font);
  return doc.save({ updateFieldAppearances: false });
}

function pageWith(page: PDFPage, heading: string, lines: string[], font: PDFFont, bold: PDFFont) {
  page.drawText(heading, { x: 60, y: 770, size: 20, font: bold });
  lines.forEach((line, index) =>
    page.drawText(line, { x: 60, y: 730 - index * 20, size: 12, font, color: rgb(0.1, 0.1, 0.1) }),
  );
}

/**
 * What the desktop demo leaves waiting in To send: the filled membership slip, addressed to the
 * person it is about (invented). Nothing is sent; the person opens it and presses Send themselves.
 */
export async function demoToSend(): Promise<OutboundMail> {
  return {
    to: 'maja.strand@example.com',
    subject: 'Din medlemsanmälan',
    text: 'Hej Maja, här är din ifyllda medlemsanmälan som PDF.',
    attachments: [
      {
        filename: 'medlemsanmalan.pdf',
        contentType: 'application/pdf',
        content: Buffer.from(await demoFormPdf(true)),
      },
    ],
  };
}

/** Three pages with a heading each, saved in the wrong order on purpose: the page work has something to do. */
export async function demoArrangedPdf(): Promise<Uint8Array> {
  const doc = await blank('Rapport från trädgårdsgruppen');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages: Array<[string, string[]]> = [
    [
      'Sida 3 - Nästa år',
      [
        'Nästa år vill gruppen plantera fler bärbuskar längs staketet.',
        'Vi tar gärna emot förslag på vilka sorter som trivs här.',
      ],
    ],
    [
      'Sida 1 - Inledning',
      [
        'Det här är en kort rapport om trädgårdsgruppens sommar.',
        'Den är påhittad och finns bara för att visa hur sidor flyttas.',
      ],
    ],
    [
      'Sida 2 - Sommaren',
      [
        'Under sommaren vattnades odlingslådorna varje morgon.',
        'Tomaterna blev sena men goda, och gurkorna räckte till alla.',
      ],
    ],
  ];
  for (const [heading, lines] of pages) pageWith(doc.addPage(A4), heading, lines, font, bold);
  return doc.save();
}
