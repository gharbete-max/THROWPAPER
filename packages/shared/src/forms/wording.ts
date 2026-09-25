/**
 * Words that mark legal, clinical, tax or safety-critical wording — `CLAUDE.md` rule 8.
 *
 * One list, used wherever Loppa itself supplies words that end up in somebody's form: the
 * templates (`templates.test.ts`) and the guided builder's example chips (`builder/graph`, rule
 * G13, ADR 0012). It used to live inside the templates test; the builder needed "the same list",
 * and two copies of a list are two lists.
 *
 * A word list cannot prove absence, and this one does not pretend to. What it does is fail loudly
 * the moment somebody reaches for those categories, which makes the boundary a decision rather
 * than something that erodes one well-meaning sentence at a time. Matching is a lower-cased
 * substring test, deliberately blunt.
 */
export const REGULATED_WORDS: readonly string[] = [
  'samtycke',
  'consent',
  'gdpr',
  'diagnos',
  'diagnosis',
  'symptom',
  'medicin',
  'medication',
  'moms',
  'vat number',
  'skatt',
  'tax',
  'personnummer',
  'social security',
  'olycka',
  'accident',
  'incident',
  'tillbud',
  'avtal',
  'contract',
  'villkor',
  'terms and conditions',
];

/** The regulated words `text` contains, lower-cased substring match. */
export function regulatedWordsIn(text: string): string[] {
  const haystack = text.toLowerCase();
  return REGULATED_WORDS.filter((word) => haystack.includes(word));
}
