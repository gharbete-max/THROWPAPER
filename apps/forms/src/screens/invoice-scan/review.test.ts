import { describe, expect, it } from 'vitest';
import { readInvoice } from '@tp/shared/payable';
import {
  fixtures,
  layoutWords,
  svStandard,
  svWrongReference,
} from '../../../../../fixtures/invoices/invoices.js';
import {
  buildRecord,
  canKeep,
  changed,
  initialStates,
  KEYS,
  ready,
  resolve,
  type States,
} from './review.js';

const NOW = new Date('2026-10-13T12:00:00Z');
const readingOf = (fixture: (typeof fixtures)[number]) => readInvoice(layoutWords(fixture));

/** The person confirms every field as it stands. */
function confirmAll(states: States): States {
  return Object.fromEntries(
    KEYS.map((key) => [key, { ...states[key], confirmed: true }]),
  ) as States;
}

describe.each(fixtures)('keeping the reviewed $name', (fixture) => {
  const reading = readingOf(fixture);

  it('keeps nothing until the person has confirmed each field', () => {
    const states = initialStates(reading);
    expect(canKeep(reading, states)).toBe(false);
    expect(buildRecord(reading, states, NOW)).toBeNull();
  });

  it('makes the record the page says once every field is confirmed', () => {
    const record = buildRecord(reading, confirmAll(initialStates(reading)), NOW)!;
    const { expected } = fixture;
    expect(record).toMatchObject({
      version: 1,
      total: expected.total,
      currency: expected.currency,
      dueDate: expected.dueDate,
      bank: expected.bank,
      reference: { kind: expected.reference.kind, value: expected.reference.value },
      vat: expected.vat,
      keptDespiteFailedCheck: [],
      reviewedAt: '2026-10-13T12:00:00.000Z',
    });
  });
});

describe('a field that is not ready', () => {
  const reading = readingOf(svStandard);

  it('is not ready until confirmed, and edits take the confirmation back', () => {
    let states = confirmAll(initialStates(reading));
    expect(ready('total', reading, states.total)).toBe(true);
    states = { ...states, total: changed(states.total, { typed: '15 000,00' }) };
    expect(ready('total', reading, states.total)).toBe(false);
    expect(resolve('total', reading, states.total).value).toEqual({
      key: 'total',
      minor: 1500000n,
    });
  });

  it('cannot leave out the total or the currency', () => {
    const states = confirmAll(initialStates(reading));
    expect(ready('total', reading, { ...states.total, omitted: true })).toBe(false);
    expect(ready('currency', reading, { ...states.currency, omitted: true })).toBe(false);
    expect(ready('reference', reading, { ...states.reference, omitted: true })).toBe(true);
  });

  it('is not ready when what was typed cannot be read', () => {
    const states = initialStates(reading);
    for (const typed of ['abc', '', '1,2,3']) {
      expect(ready('total', reading, { ...states.total, typed, confirmed: true })).toBe(false);
    }
    const date = { ...states.dueDate, confirmed: true };
    expect(ready('dueDate', reading, { ...date, typed: '31.02.2026' })).toBe(false);
    expect(ready('dueDate', reading, { ...date, typed: '03/04/2026' })).toBe(false);
    expect(resolve('dueDate', reading, { ...date, typed: '03/04/2026' }).problem).toBe('ambiguous');
    expect(ready('dueDate', reading, { ...date, typed: '2026-12-01' })).toBe(true);
  });

  it('leaves a missing VAT out without asking, and a missing reference not', () => {
    const none = readInvoice([]);
    const states = initialStates(none);
    expect(states.vat.omitted).toBe(true);
    expect(states.reference.omitted).toBe(false);
    expect(ready('reference', none, states.reference)).toBe(false);
  });
});

describe('a failed check digit', () => {
  const reading = readingOf(svWrongReference);

  it('is not accepted by confirming it', () => {
    const states = confirmAll(initialStates(reading));
    expect(resolve('reference', reading, states.reference).check).toBe('failed');
    expect(ready('reference', reading, states.reference)).toBe(false);
    expect(canKeep(reading, states)).toBe(false);
  });

  it('is kept only by a separate decision, and the record says so', () => {
    const states = confirmAll(initialStates(reading));
    const kept = { ...states, reference: { ...states.reference, keep: true } };
    expect(buildRecord(reading, kept, NOW)).toMatchObject({
      reference: { value: '202611498' },
      keptDespiteFailedCheck: ['reference'],
    });
  });

  it('is put right by typing the number as the page prints it, and then passes', () => {
    const states = confirmAll(initialStates(reading));
    const fixed = changed(states.reference, { typed: '2026 1149 7' });
    const resolved = resolve('reference', reading, fixed);
    expect(resolved.check).toBe('passed');
    expect(ready('reference', reading, { ...fixed, confirmed: true })).toBe(true);
  });

  it('checks a typed bank number by the kind chosen', () => {
    const bank = initialStates(reading).bank;
    expect(resolve('bank', reading, { ...bank, typed: '123-4566', method: 'bankgiro' }).check).toBe(
      'passed',
    );
    expect(resolve('bank', reading, { ...bank, typed: '123-4566', method: 'iban' }).check).toBe(
      'failed',
    );
    expect(resolve('bank', reading, { ...bank, typed: '123456-6', method: 'plusgiro' }).check).toBe(
      'passed',
    );
  });
});
