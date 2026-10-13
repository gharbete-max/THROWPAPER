import { describe, expect, it } from 'vitest';
import { sortedRows } from './send-rows.js';

const row = (name: string, amount: string) => ({ name, email: '', amount, reference: '' });

describe('sorting a batch list', () => {
  it('puts å, ä and ö after z in Swedish, and not in German', () => {
    const rows = [
      row('Östen', '1'),
      row('Zeke', '1'),
      row('Åsa', '1'),
      row('Anna', '1'),
      row('Ärlig', '1'),
    ];
    expect(sortedRows(rows, 'name', 'asc', 'sv-SE').map((r) => r.name)).toEqual([
      'Anna',
      'Zeke',
      'Åsa',
      'Ärlig',
      'Östen',
    ]);
    expect(sortedRows(rows, 'name', 'asc', 'de-DE').map((r) => r.name)[1]).toBe('Ärlig');
  });

  it('sorts the amount as a number, not as the text it was written as', () => {
    const rows = [
      row('a', '1 000,00'),
      row('b', '9'),
      row('c', '10,50'),
      row('d', 'x'),
      row('e', '100'),
    ];
    expect(sortedRows(rows, 'amount', 'asc', 'sv-SE').map((r) => r.name)).toEqual([
      'b',
      'c',
      'e',
      'a',
      'd',
    ]);
    // Descending reverses the numbers; what is not an amount still goes last.
    expect(sortedRows(rows, 'amount', 'desc', 'sv-SE').map((r) => r.name)).toEqual([
      'a',
      'e',
      'c',
      'b',
      'd',
    ]);
  });

  it('leaves the list in the order it was made', () => {
    const rows = [row('b', '2'), row('a', '1')];
    sortedRows(rows, 'name', 'asc', 'sv-SE');
    expect(rows.map((r) => r.name)).toEqual(['b', 'a']);
  });
});
