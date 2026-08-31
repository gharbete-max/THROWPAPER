/**
 * CLAUDE.md rule 6 — ICU collation. Swedish sorts å ä ö after z; Danish and Norwegian sort æ ø å.
 * Large sorts belong in Postgres; this is for short in-memory lists only.
 */
export function collator(locale: string): Intl.Collator {
  return new Intl.Collator(locale, { numeric: false, sensitivity: 'variant', caseFirst: 'lower' });
}

export function compareText(locale: string, a: string, b: string): number {
  return collator(locale).compare(a, b);
}
