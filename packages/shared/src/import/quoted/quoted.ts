import { z } from 'zod';
import lexicon from './lexicon.json';

/**
 * Which texts are quoted and never reworded or translated (CLAUDE.md rule 8, ADR 0012, ADR 0023
 * section 4): contracts, consents, declarations and clinical forms.
 *
 * Rule-based, with word lists in the twelve languages and fixtures — **never the model**, and
 * nothing here may import one. The lists are detection terms, not wording that a document may use.
 *
 * ## How it decides
 *
 * A category matches when **two different terms** from its lists are found, in any language: one
 * word such as "patient" is a newsletter about a patient choir, two of them are a clinical form.
 * Terms are matched case-insensitively as whole words; a trailing `*` matches the start of a word
 * (`avtal*` finds "avtalet"). Chinese and Japanese terms match as plain text, as those scripts
 * have no spaces.
 *
 * ## Which way it errs
 *
 * Towards quoting. A newsletter that reads like a contract is shown as passages of itself, which
 * costs the person a summary; a contract that reads like a newsletter would be reworded by a
 * model, which is the harm. So the threshold is low, there is no way to switch it off, and a
 * missing language never relaxes it.
 */
export const QUOTED_CATEGORIES = ['contract', 'consent', 'declaration', 'clinical'] as const;
export type QuotedCategory = (typeof QUOTED_CATEGORIES)[number];

const Lexicon = z
  .object({
    categories: z.record(
      z.enum(QUOTED_CATEGORIES),
      z.record(z.string(), z.array(z.string().min(1))),
    ),
    version: z.literal(1),
    source: z.string().min(1),
  })
  .strict();
export const QUOTED_LEXICON = Lexicon.parse(lexicon);

/** Distinct terms of a category needed to call a text that kind of document. */
export const TERMS_NEEDED = 2;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[‘’ʼ]/g, "'");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Matcher {
  /** The term without its `*`, the same in every language that spells it so. */
  key: string;
  category: QuotedCategory;
  pattern: RegExp;
}

const MATCHERS: Matcher[] = QUOTED_CATEGORIES.flatMap((category) =>
  Object.values(QUOTED_LEXICON.categories[category] ?? {}).flatMap((terms) =>
    terms.map((raw) => {
      const prefix = raw.endsWith('*');
      const term = normalise(prefix ? raw.slice(0, -1) : raw);
      const body = escape(term).replace(/ /g, '\\s+');
      const pattern = CJK.test(term)
        ? new RegExp(body, 'u')
        : new RegExp(`(?<![\\p{L}\\p{N}])${body}${prefix ? '' : '(?![\\p{L}\\p{N}])'}`, 'u');
      return { key: term, category, pattern };
    }),
  ),
);

export interface QuotedVerdict {
  /** True when the text must be quoted and never reworded or translated. */
  quoteOnly: boolean;
  categories: QuotedCategory[];
  /** The distinct terms found per category, for a fixture's failure message and a reviewer. */
  terms: Partial<Record<QuotedCategory, string[]>>;
}

export function mustQuote(text: string): QuotedVerdict {
  const haystack = normalise(text);
  // Per category: where a term starts -> the longest term found starting there. One word that
  // two stems both match ("diagnosticians" for diagnos* and diagnostic*) is still one word.
  const at = new Map<QuotedCategory, Map<number, string>>();
  for (const matcher of MATCHERS) {
    const start = haystack.search(matcher.pattern);
    if (start < 0) continue;
    const here = at.get(matcher.category) ?? new Map<number, string>();
    const held = here.get(start);
    if (held === undefined || matcher.key.length > held.length) here.set(start, matcher.key);
    at.set(matcher.category, here);
  }
  const found = new Map([...at].map(([c, here]) => [c, new Set(here.values())]));
  const categories = QUOTED_CATEGORIES.filter((c) => (found.get(c)?.size ?? 0) >= TERMS_NEEDED);
  return {
    quoteOnly: categories.length > 0,
    categories,
    terms: Object.fromEntries([...found].map(([c, set]) => [c, [...set].sort()])),
  };
}
