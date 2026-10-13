import { parseMinor, type BatchRow } from '@tp/shared/api';
import { collator } from '@tp/i18n';

export type SortColumn = keyof BatchRow;

/**
 * A list's rows in a column's order, as a new array (the list keeps its own order, which is the
 * order the documents are made in). Words sort by the language's own collation — Swedish puts å ä ö
 * after z — and the amount sorts as a number, never as the text it was written as: 9 before 10.
 * An amount that is not one goes last either way.
 */
export function sortedRows<T extends BatchRow>(
  rows: readonly T[],
  column: SortColumn,
  direction: 'asc' | 'desc',
  locale: string,
): T[] {
  const words = collator(locale);
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (column === 'amount') {
      const x = parseMinor(a.amount);
      const y = parseMinor(b.amount);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return x === y ? 0 : (x < y ? -1 : 1) * sign;
    }
    return words.compare(a[column], b[column]) * sign;
  });
}
