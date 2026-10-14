/**
 * Synthetic pages for the digital copy's end-to-end test (`e2e/digital-copy.spec.ts`), written for
 * this repository: invented labels, no real person or layout. Each is drawn from a list of ruled
 * lines and text, so the lines a correct copy must find are known exactly, in pixels of an A4 page
 * at 150 dots an inch; the browser draws the page and screenshots it into the "photograph".
 */

export const PAGE_PX = { width: 1240, height: 1754 } as const;

export interface Rule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Text {
  text: string;
  x: number;
  y: number;
  /** Pixels; the body is 26. */
  size?: number;
}

export interface CopyPage {
  name: string;
  /** The language the page is in, and so the language to read it as. */
  locale: 'en-GB' | 'sv-SE';
  rules: Rule[];
  texts: Text[];
  /** Every word a correct reading finds. */
  words: string[];
}

const h = (y: number, x1: number, x2: number): Rule => ({ x1, y1: y, x2, y2: y });
const v = (x: number, y1: number, y2: number): Rule => ({ x1: x, y1, x2: x, y2 });
const box = (x1: number, y1: number, x2: number, y2: number): Rule[] => [
  h(y1, x1, x2),
  h(y2, x1, x2),
  v(x1, y1, y2),
  v(x2, y1, y2),
];

const wordsOf = (texts: Text[]) => texts.flatMap((t) => t.text.split(/\s+/));

const COLUMNS = [100, 440, 740, 1000, 1140];
const ROWS = [260, 360, 460, 560, 660];
const tableTexts: Text[] = [
  { text: 'Quarterly stock count', x: 100, y: 130, size: 44 },
  ...[
    ['Item', 'Counted', 'Expected', 'Difference'],
    ['Bolts', 'Hundred', 'Ninety', 'Twenty'],
    ['Washers', 'Seventy', 'Eighty', 'Five'],
    ['Brackets', 'Forty', 'Forty', 'Zero'],
  ].flatMap((cells, r) =>
    cells.map((text, c) => ({ text, x: COLUMNS[c]! + 20, y: ROWS[r]! + 34 })),
  ),
  { text: 'Counted by the warehouse team', x: 100, y: 780 },
];
/** A ruled table: a box, three inner columns and three inner rows. */
export const ruledTable: CopyPage = {
  name: 'ruled-table',
  locale: 'en-GB',
  rules: [
    ...ROWS.map((y) => h(y, COLUMNS[0]!, COLUMNS[4]!)),
    ...COLUMNS.map((x) => v(x, ROWS[0]!, ROWS[4]!)),
  ],
  texts: tableTexts,
  words: wordsOf(tableTexts),
};

const formTexts: Text[] = [
  { text: 'Anmälan till kursen', x: 100, y: 130, size: 44 },
  { text: 'Förnamn', x: 100, y: 300 },
  { text: 'Efternamn', x: 100, y: 400 },
  { text: 'Adress', x: 100, y: 500 },
  { text: 'Telefonnummer', x: 100, y: 600 },
  { text: 'Meddelande', x: 100, y: 760 },
  { text: 'Tack för din anmälan', x: 100, y: 1180 },
];
/** A form: four labelled lines to write on, and a box for a longer answer. */
export const linedForm: CopyPage = {
  name: 'lined-form',
  locale: 'sv-SE',
  rules: [
    ...[310, 410, 510, 610].map((y) => h(y, 420, 1140)),
    ...box(100, 790, 1140, 1100),
  ],
  texts: formTexts,
  words: wordsOf(formTexts),
};

const invoiceTexts: Text[] = [
  { text: 'Invoice', x: 110, y: 150, size: 44 },
  { text: 'Number 2026', x: 110, y: 220 },
  { text: 'Customer', x: 730, y: 150 },
  { text: 'Northern Trading', x: 730, y: 220 },
  { text: 'Description', x: 110, y: 430 },
  { text: 'Amount', x: 900, y: 430 },
  { text: 'Consulting', x: 110, y: 530 },
  { text: 'Hosting', x: 110, y: 630 },
  { text: 'Support', x: 110, y: 730 },
  { text: 'Total', x: 780, y: 1010 },
  { text: 'Payable', x: 780, y: 1110 },
];
/** An invoice: a header box with a divider, an items table of rules only, and a totals box. */
export const invoiceBoxes: CopyPage = {
  name: 'invoice-boxes',
  locale: 'en-GB',
  rules: [
    ...box(80, 80, 1160, 300),
    v(700, 80, 300),
    h(480, 80, 1160),
    h(580, 80, 1160),
    h(680, 80, 1160),
    h(780, 80, 1160),
    ...box(740, 960, 1160, 1160),
    h(1060, 740, 1160),
  ],
  texts: invoiceTexts,
  words: wordsOf(invoiceTexts),
};

export const copyPages: CopyPage[] = [ruledTable, linedForm, invoiceBoxes];

/** The page as HTML to screenshot: black rules two pixels thick, text in one plain face. */
export function copyHtml(page: CopyPage): string {
  const rules = page.rules
    .map((r) => {
      const left = Math.min(r.x1, r.x2);
      const top = Math.min(r.y1, r.y2);
      const width = Math.abs(r.x2 - r.x1) || 2;
      const height = Math.abs(r.y2 - r.y1) || 2;
      return `<div style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:#000"></div>`;
    })
    .join('');
  const texts = page.texts
    .map(
      (t) =>
        `<div style="position:absolute;left:${t.x}px;top:${t.y - (t.size ?? 26)}px;font:${t.size ?? 26}px Arial,Helvetica,sans-serif;line-height:1.2;white-space:nowrap;color:#000">${t.text}</div>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><div style="position:relative;width:${PAGE_PX.width}px;height:${PAGE_PX.height}px;background:#fff">${rules}${texts}</div>`;
}
