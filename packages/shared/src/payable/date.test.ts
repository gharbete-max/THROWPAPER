import { describe, expect, it } from 'vitest';
import { parseDate } from './date.js';

const ok = (iso: string) => ({ status: 'ok', iso });

describe('parseDate: unambiguous formats', () => {
  it.each([
    ['2026-10-31', '2026-10-31'],
    ['31.10.2026', '2026-10-31'], // dot is day first everywhere it is used
    ['31.10.26', '2026-10-31'],
    ['1.3.2026', '2026-03-01'],
    ['31/10/2026', '2026-10-31'], // day above 12 settles it
    ['10/31/2026', '2026-10-31'],
    ['31-10-2026', '2026-10-31'],
    ['20261031', '2026-10-31'],
    ['31 oktober 2026', '2026-10-31'], // Swedish, Danish, Norwegian, German, English
    ['31. oktober 2026', '2026-10-31'],
    ['31. Oktober 2026', '2026-10-31'],
    ['31 October 2026', '2026-10-31'],
    ['October 31, 2026', '2026-10-31'],
    ['31 okt 2026', '2026-10-31'],
    ['1 mars 2026', '2026-03-01'],
    ['1. März 2026', '2026-03-01'],
    ['3 maj 2026', '2026-05-03'],
    ['3 Mai 2026', '2026-05-03'],
    ['29.02.2028', '2028-02-29'],
  ])('%s is %s', (text, iso) => {
    expect(parseDate(text)).toEqual(ok(iso));
  });
});

describe('parseDate: asks when day and month could be either', () => {
  it.each([
    ['03/04/2026', ['2026-04-03', '2026-03-04']],
    ['03-04-2026', ['2026-04-03', '2026-03-04']],
  ])('%s offers both readings, day first', (text, candidates) => {
    expect(parseDate(text)).toEqual({ status: 'ask', candidates });
  });
  it('does not ask when both readings are the same day', () => {
    expect(parseDate('05/05/2026')).toEqual(ok('2026-05-05'));
  });
});

describe('parseDate: refuses what is not a date', () => {
  it.each([
    '',
    'soon',
    '31.02.2026',
    '29.02.2027',
    '32.01.2026',
    '13/13/2026',
    '2026-13-01',
    '0.0.2026',
  ])('"%s" is invalid', (text) => {
    expect(parseDate(text)).toEqual({ status: 'invalid' });
  });
});
