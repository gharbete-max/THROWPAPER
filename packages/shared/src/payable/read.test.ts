import { describe, expect, it } from 'vitest';
import {
  daStandard,
  deStandard,
  enStandard,
  fixtures,
  layoutWords,
  svStacked,
  svStandard,
  svWrongReference,
  type InvoiceFixture,
} from '../../../../fixtures/invoices/invoices.js';
import { readInvoice, UNSURE_BELOW } from './read.js';

const read = (fixture: InvoiceFixture) => readInvoice(layoutWords(fixture));

describe.each(fixtures)('reading the synthetic invoice $name ($locale)', (fixture) => {
  const reading = read(fixture);
  const { expected } = fixture;

  it('finds the total, exactly, in minor units', () => {
    expect(reading.total.status).toBe('found');
    expect(reading.total.candidates[0]?.value).toBe(BigInt(expected.total));
  });
  it('finds the currency', () => {
    expect(reading.currency.candidates[0]?.value).toBe(expected.currency);
    expect(reading.currency.status).toBe('found');
  });
  it('finds the due date, not the invoice date', () => {
    expect(reading.dueDate.status).toBe('found');
    expect(reading.dueDate.candidates[0]?.value).toBe(expected.dueDate);
  });
  it('finds the bank number, its check digit passed', () => {
    expect(reading.bank.status).toBe('found');
    expect(reading.bank.candidates[0]?.value).toEqual(expected.bank);
    expect(reading.bank.candidates[0]?.check).toBe('passed');
  });
  it('finds the payment reference, checked', () => {
    expect(reading.reference.status).toBe('found');
    const one = reading.reference.candidates[0]!;
    expect(one.value).toEqual({ kind: expected.reference.kind, value: expected.reference.value });
    expect(one.check).toBe(expected.reference.check);
  });
  it('reads the VAT amount the page prints, and no other', () => {
    expect(reading.vat.candidates.map((c) => c.value)).toEqual([BigInt(expected.vat!)]);
  });
  it('says where each value was found: a box on the page, inside it', () => {
    for (const field of [reading.total, reading.dueDate, reading.bank, reading.reference]) {
      const { where } = field.candidates[0]!;
      expect(where.page).toBe(1);
      expect(where.x0).toBeGreaterThanOrEqual(0);
      expect(where.x1).toBeLessThanOrEqual(1);
      expect(where.y1).toBeGreaterThan(where.y0);
      expect(where.y1).toBeLessThanOrEqual(1);
    }
  });
});

describe('optical reading that drops the diacritics', () => {
  const dropped = (fixture: InvoiceFixture, from: string, to: string): InvoiceFixture => ({
    ...fixture,
    items: fixture.items.map((i) => ({ ...i, text: i.text.replace(from, to) })),
  });
  it('still finds a Swedish due date and a German one', () => {
    expect(
      read(dropped(svStandard, 'Förfallodatum', 'Forfallodatum')).dueDate.candidates[0]?.value,
    ).toBe('2026-11-30');
    expect(read(dropped(deStandard, 'Fällig am', 'Fallig am')).dueDate.candidates[0]?.value).toBe(
      '2026-11-30',
    );
    expect(
      read(dropped(daStandard, 'Beløb at betale', 'Belob at betale')).total.candidates[0]?.value,
    ).toBe(841275n);
  });
});

describe('where on the page', () => {
  it('outlines the total to pay, not the totals above it', () => {
    const where = read(svStandard).total.candidates[0]!.where;
    // "Att betala" is the row at y 0.69; "Totalt" (0.64) holds the same figure but is the weaker label.
    expect(where.y0).toBeCloseTo(0.69, 2);
    expect(where.x0).toBeGreaterThan(0.7);
  });
});

describe('a wrong or misread reference is flagged, never accepted', () => {
  it('fails the check digit of an OCR number with one digit changed', () => {
    const reading = read(svWrongReference);
    expect(reading.reference.candidates).toHaveLength(1);
    expect(reading.reference.candidates[0]).toMatchObject({
      check: 'failed',
      value: { kind: 'ocr', value: '202611498' },
    });
  });
  it('fails an OCR number with a digit dropped (the length digit disagrees)', () => {
    const dropped = {
      ...svStandard,
      items: svStandard.items.map((i) =>
        i.text.startsWith('OCR-nummer') ? { ...i, text: 'OCR-nummer 20261147' } : i,
      ),
    };
    expect(read(dropped).reference.candidates[0]?.check).toBe('failed');
  });
  it('fails an IBAN and an RF reference with a digit changed', () => {
    const iban = {
      ...deStandard,
      items: deStandard.items.map((i) =>
        i.text.startsWith('IBAN') ? { ...i, text: 'IBAN DE89 3704 0044 0532 0130 01' } : i,
      ),
    };
    expect(read(iban).bank.candidates[0]).toMatchObject({ check: 'failed' });
    const rf = {
      ...enStandard,
      items: enStandard.items.map((i) =>
        i.text.startsWith('Payment reference')
          ? { ...i, text: 'Payment reference: RF09 INV2 0260 18' }
          : i,
      ),
    };
    expect(read(rf).reference.candidates[0]).toMatchObject({ check: 'failed' });
  });
  it('fails a bankgiro with a digit changed', () => {
    const bad = {
      ...svStandard,
      items: svStandard.items.map((i) =>
        i.text.startsWith('Bankgiro') ? { ...i, text: 'Bankgiro 123-4567' } : i,
      ),
    };
    expect(read(bad).bank.candidates[0]).toMatchObject({ check: 'failed' });
  });
  it('flags a reference with a letter where a digit was misread', () => {
    const garbled = {
      ...svStandard,
      items: svStandard.items.map((i) =>
        i.text.startsWith('OCR-nummer') ? { ...i, text: 'OCR-nummer 2026l1497' } : i,
      ),
    };
    expect(read(garbled).reference.candidates[0]).toMatchObject({ check: 'failed' });
  });
  it('does not take a person reference ("Er referens") for a payment reference', () => {
    expect(read(svStacked).reference.candidates.map((c) => c.text)).toEqual(['4417 66']);
  });
  it('misses a reference rather than inventing one', () => {
    const none = {
      ...svStandard,
      items: svStandard.items.filter((i) => !i.text.startsWith('OCR')),
    };
    expect(read(none).reference).toEqual({ status: 'missing', candidates: [] });
  });
});

describe('asks when unsure', () => {
  const only = (items: InvoiceFixture['items']): InvoiceFixture => ({ ...svStandard, items });
  const label = (text: string, value: string, y = 0.5) => [
    { text, x: 0.1, y },
    { text: value, x: 0.6, y },
  ];

  it('asks for two different amounts under the same strongest label', () => {
    const reading = read(
      only([...label('Att betala', '1 000,00', 0.4), ...label('Att betala', '2 000,00', 0.5)]),
    );
    expect(reading.total.status).toBe('ask');
    expect(reading.total.candidates.map((c) => c.value)).toEqual([100000n, 200000n]);
  });
  it('is not unsure when the same amount is printed twice', () => {
    const reading = read(
      only([...label('Att betala', '1 000,00', 0.4), ...label('Totalt', '1 000,00', 0.5)]),
    );
    expect(reading.total.status).toBe('found');
  });
  it('asks about "1.234": a thousands mark or a mistake', () => {
    const reading = read(only(label('Att betala', '1.234 kr')));
    expect(reading.total.status).toBe('ask');
    expect(reading.total.candidates[0]).toMatchObject({ value: 123400n, flags: ['format-unsure'] });
  });
  it('asks about a date whose day and month could be either', () => {
    const reading = read(only(label('Förfallodatum', '03/04/2026')));
    expect(reading.dueDate.status).toBe('ask');
    expect(reading.dueDate.candidates.map((c) => c.value)).toEqual(['2026-04-03', '2026-03-04']);
  });
  it('keeps a date it could not read as the words it was, not as nothing', () => {
    const reading = read(only(label('Förfallodatum', '31.02.2026')));
    expect(reading.dueDate.status).toBe('ask');
    expect(reading.dueDate.candidates[0]).toMatchObject({
      value: null,
      text: '31.02.2026',
      check: 'failed',
    });
  });
  it('asks which currency when "kr" has no bank number to settle it', () => {
    const reading = read(only(label('Att betala', '1 250,00 kr')));
    expect(reading.currency.status).toBe('ask');
    expect(reading.currency.candidates.map((c) => c.value)).toEqual(['SEK', 'DKK', 'NOK']);
  });
  it('asks which bank number to use when the page offers two', () => {
    const reading = read(
      only([
        ...label('Bankgiro', '123-4566', 0.4),
        ...label('IBAN', 'SE45 5000 0000 0583 9825 7466', 0.5),
      ]),
    );
    expect(reading.bank.status).toBe('ask');
    expect(reading.bank.candidates.map((c) => c.value?.method)).toEqual(['bankgiro', 'iban']);
  });
  it('asks which currency when the page prints two codes and none is beside the total', () => {
    const reading = read(
      only([
        ...label('Att betala', '1 250,00', 0.8),
        { text: 'SEK', x: 0.1, y: 0.1 },
        { text: 'EUR', x: 0.3, y: 0.1 },
      ]),
    );
    expect(reading.currency.status).toBe('ask');
  });
});

describe('what is never read or worked out', () => {
  it('does not take the amount before VAT for the total', () => {
    const reading = read({
      ...svStandard,
      items: [
        { text: 'Summa exkl. moms', x: 0.1, y: 0.5 },
        { text: '12 000,00', x: 0.6, y: 0.5 },
        { text: 'Moms 25 %', x: 0.1, y: 0.55 },
        { text: '3 000,00', x: 0.6, y: 0.55 },
      ],
    });
    expect(reading.total.status).toBe('missing');
    expect(reading.vat.candidates.map((c) => c.value)).toEqual([300000n]);
  });
  it('does not make a due date from "30 days"', () => {
    expect(read(deStandard).dueDate.candidates).toHaveLength(1);
    const terms = {
      ...svStandard,
      items: [{ text: 'Betalningsvillkor 30 dagar', x: 0.1, y: 0.2 }],
    };
    expect(read(terms).dueDate.status).toBe('missing');
  });
  it('does not compute VAT from a rate when the page prints none', () => {
    const noVat = {
      ...enStandard,
      items: enStandard.items.filter((i) => !i.text.startsWith('VAT')),
    };
    expect(read(noVat).vat).toEqual({ status: 'missing', candidates: [] });
  });
  it('finds nothing on an empty page', () => {
    const reading = readInvoice([]);
    for (const field of Object.values(reading)) expect(field.status).toBe('missing');
  });
});

describe('a payment reference printed as one item (a PDF text layer)', () => {
  const word = (text: string, x0: number, y0 = 0.3) => ({
    page: 0,
    text,
    x0,
    y0,
    x1: x0 + 0.05,
    y1: y0 + 0.02,
    confidence: 100,
  });

  it('reads an unspaced RF reference instead of throwing', () => {
    const reading = readInvoice([word('Referens', 0.1), word('RF18539007547034', 0.25)]);
    expect(reading.reference.candidates[0]?.value).toEqual({
      kind: 'rf',
      value: 'RF18 5390 0754 7034',
    });
    expect(reading.reference.candidates[0]?.check).toBe('passed');
  });

  it('keeps a reference of a first word that no rule accepts as a failed reading, not a crash', () => {
    const reading = readInvoice([word('OCR', 0.1), word('RF18-5390-0754-7034', 0.25)]);
    expect(reading.reference.candidates[0]?.check).not.toBe('passed');
  });
});

describe('optical reading that was unsure', () => {
  it('flags a value with a word below the confidence line', () => {
    const words = layoutWords(daStandard).map((w) =>
      w.text === '8.412,75' ? { ...w, confidence: UNSURE_BELOW - 1 } : w,
    );
    const total = readInvoice(words).total.candidates[0]!;
    expect(total.flags).toContain('ocr-unsure');
    expect(total.confidence).toBe(UNSURE_BELOW - 1);
  });
  it('rebuilds rows from positions, so a label and a far-off value are one row', () => {
    // Every word its own "line": rows come from the boxes, not from any grouping optical reading made.
    const words = layoutWords(svStandard).reverse();
    expect(readInvoice(words).total.candidates[0]?.value).toBe(1500000n);
  });
});
