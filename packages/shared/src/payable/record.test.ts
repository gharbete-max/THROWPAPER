import { describe, expect, it } from 'vitest';
import { decimalOf, payableCsv, payableJson, ReviewedPayable } from './record.js';

const record: ReviewedPayable = {
  version: 1,
  total: '1500000',
  currency: 'SEK',
  dueDate: '2026-11-30',
  bank: { method: 'bankgiro', account: '123-4566' },
  reference: { kind: 'ocr', value: '202611497' },
  vat: '300000',
  keptDespiteFailedCheck: [],
  reviewedAt: '2026-10-13T12:00:00.000Z',
};

describe('the reviewed record', () => {
  it('is valid, and survives JSON', () => {
    expect(ReviewedPayable.parse(JSON.parse(payableJson(record)))).toEqual(record);
  });
  it('refuses an amount that is not whole minor units', () => {
    expect(ReviewedPayable.safeParse({ ...record, total: '1500.50' }).success).toBe(false);
  });
  it('writes minor units as an exact decimal', () => {
    expect(decimalOf('1500000')).toBe('15000.00');
    expect(decimalOf('5')).toBe('0.05');
    expect(decimalOf('9007199254740993')).toBe('90071992547409.93');
  });
  it('makes a header and one row, with a point for decimals', () => {
    expect(payableCsv(record).split('\n')).toEqual([
      'total,currency,due_date,bank_method,bank_account,reference_kind,reference,vat,kept_despite_failed_check,reviewed_at',
      '15000.00,SEK,2026-11-30,bankgiro,123-4566,ocr,202611497,3000.00,,2026-10-13T12:00:00.000Z',
      '',
    ]);
  });
  it('keeps what a spreadsheet would run as a formula from running', () => {
    const csv = payableCsv({
      ...record,
      reference: { kind: 'text', value: '=HYPERLINK("http://x","y")' },
      keptDespiteFailedCheck: ['reference'],
    });
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(',reference,');
  });
  it('leaves absent parts empty, not invented', () => {
    const csv = payableCsv({ ...record, dueDate: null, bank: null, reference: null, vat: null });
    expect(csv.split('\n')[1]).toBe('15000.00,SEK,,,,,,,,2026-10-13T12:00:00.000Z');
  });
});
