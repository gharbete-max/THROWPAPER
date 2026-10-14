import { Email, type SuppressionList } from '@tp/shared/api';
import { collator } from '@tp/i18n';

type Entry = SuppressionList['items'][number];

/** The do-not-email list by address, in the language's own collation (not code-point order). */
export function sortedSuppressions(items: readonly Entry[], locale: string): Entry[] {
  const words = collator(locale);
  return [...items].sort((a, b) => words.compare(a.email, b.email));
}

/** The trimmed address when it is one the API will accept, else null. */
export function validAddress(input: string): string | null {
  const parsed = Email.safeParse(input.trim());
  return parsed.success ? parsed.data : null;
}
