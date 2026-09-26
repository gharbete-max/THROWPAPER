import { z } from 'zod';
import { optionsOf, type BuilderGraph } from '../builder/graph/schema.js';
import da from './aliases/da.json';
import de from './aliases/de.json';
import en from './aliases/en.json';
import es from './aliases/es.json';
import fi from './aliases/fi.json';
import fr from './aliases/fr.json';
import is from './aliases/is.json';
import ja from './aliases/ja.json';
import nb from './aliases/nb.json';
import ru from './aliases/ru.json';
import sv from './aliases/sv.json';
import zh from './aliases/zh.json';
import { LANGUAGES, type Language } from './lexicon.js';
import { compareCodePoints, keyOf } from './text.js';

/**
 * Aliases — the ways of saying an option that T0–T3 match (`docs/plan/INTENT-LADDER.md`,
 * "Aliases: `aliases.json`"). The built-in ones ship as `aliases/<language>.json`; learned ones
 * (S6) are exported and imported as a file of exactly the same shape, so one schema and one writer
 * serve both.
 *
 * Every card's own label is among its built-in aliases, in every language: typing what the card
 * says reads as that card (`apps/forms/src/lib/guided-ladder.test.ts` holds the catalogues and
 * these files to each other).
 */

export const ALIASES_VERSION = 1;
export const ALIAS_SOURCES = ['built-in', 'user-confirmed', 'imported'] as const;

export const AliasEntry = z
  .object({
    /** Verbatim as typed, 1–80 characters; matched after normalisation. */
    phrase: z.string().refine((s) => [...s].length >= 1 && [...s].length <= 80, '1–80 characters'),
    nodeId: z.string().min(1),
    optionId: z.string().min(1),
    /** A primary language subtag of a shipped locale. */
    locale: z.enum(LANGUAGES),
    source: z.enum(ALIAS_SOURCES),
    /** A date and nothing more identifying. */
    createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** How often it has matched; orders the admin list, nothing else. */
    count: z.number().int().min(0),
    notes: z.string(),
  })
  .strict();
export type AliasEntry = z.infer<typeof AliasEntry>;

export const AliasFile = z
  .object({ aliasesVersion: z.literal(ALIASES_VERSION), entries: z.array(AliasEntry) })
  .strict();
export type AliasFile = z.infer<typeof AliasFile>;

const order = (a: AliasEntry, b: AliasEntry) =>
  compareCodePoints(a.locale, b.locale) ||
  compareCodePoints(a.nodeId, b.nodeId) ||
  compareCodePoints(a.optionId, b.optionId) ||
  compareCodePoints(a.phrase, b.phrase);

/** By locale, node, option and phrase, in code-point order. */
export function sortEntries(entries: readonly AliasEntry[]): AliasEntry[] {
  return [...entries].sort(order);
}

/**
 * An alias file's bytes: keys in the schema's order, entries sorted, two-space indentation and a
 * final newline — so the same aliases always give the same file, and a diff of it reads.
 */
export function formatAliasFile(file: AliasFile): string {
  const entries = sortEntries(file.entries).map((e) => ({
    phrase: e.phrase,
    nodeId: e.nodeId,
    optionId: e.optionId,
    locale: e.locale,
    source: e.source,
    createdAt: e.createdAt,
    count: e.count,
    notes: e.notes,
  }));
  return `${JSON.stringify({ aliasesVersion: file.aliasesVersion, entries }, null, 2)}\n`;
}

/** The shipped files, as they are on disk. */
export const BUILTIN_ALIAS_FILES: Readonly<Record<Language, unknown>> = {
  en,
  sv,
  da,
  nb,
  fi,
  is,
  de,
  fr,
  es,
  zh,
  ja,
  ru,
};

/** Every built-in alias. The files are checked by `aliasProblems`, in `pnpm builder:validate`. */
export const BUILTIN_ALIASES: readonly AliasEntry[] = LANGUAGES.flatMap(
  (language) => AliasFile.parse(BUILTIN_ALIAS_FILES[language]).entries,
);

export interface AliasProblem {
  readonly language: Language;
  readonly rule:
    | 'schema'
    | 'order'
    | 'locale'
    | 'source'
    | 'unknown-node'
    | 'unknown-option'
    | 'empty'
    | 'duplicate'
    | 'collision'
    | 'shadows-id'
    | 'uncovered';
  readonly nodeId?: string;
  readonly optionId?: string;
  readonly phrase?: string;
  readonly message: string;
}

/**
 * The built-in alias files against the graph. Every entry names a node and an option that exist;
 * within a node, no two options share a way of being said and no alias is another option's id
 * (either would make T0 ambiguous); and every option can be typed in every language.
 */
export function aliasProblems(
  graph: BuilderGraph,
  files: Readonly<Record<Language, unknown>> = BUILTIN_ALIAS_FILES,
): AliasProblem[] {
  const problems: AliasProblem[] = [];
  for (const language of LANGUAGES) {
    const parsed = AliasFile.safeParse(files[language]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push({
        language,
        rule: 'schema',
        message: `${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`,
      });
      continue;
    }
    const { entries } = parsed.data;
    const sorted = sortEntries(entries);
    if (sorted.some((entry, i) => entry !== entries[i])) {
      problems.push({ language, rule: 'order', message: 'entries are not in canonical order' });
    }
    const said = new Map<string, string>();
    for (const entry of entries) {
      const at = { language, nodeId: entry.nodeId, optionId: entry.optionId, phrase: entry.phrase };
      if (entry.locale !== language) {
        problems.push({ ...at, rule: 'locale', message: `says ${entry.locale}` });
      }
      if (entry.source !== 'built-in') {
        problems.push({ ...at, rule: 'source', message: `a shipped alias is ${entry.source}` });
      }
      const node = graph.nodes.find((n) => n.id === entry.nodeId);
      if (!node) {
        problems.push({ ...at, rule: 'unknown-node', message: `no node ${entry.nodeId}` });
        continue;
      }
      const options = optionsOf(node);
      if (!options.some((o) => o.id === entry.optionId)) {
        problems.push({ ...at, rule: 'unknown-option', message: `no option ${entry.optionId}` });
        continue;
      }
      const key = keyOf(entry.phrase);
      if (key === '') {
        problems.push({ ...at, rule: 'empty', message: 'normalises to nothing' });
        continue;
      }
      const other = options.find((o) => o.id !== entry.optionId && keyOf(o.id) === key);
      if (other) {
        problems.push({ ...at, rule: 'shadows-id', message: `is option ${other.id}'s id` });
      }
      const before = said.get(`${entry.nodeId}\n${key}`);
      if (before === entry.optionId) {
        problems.push({ ...at, rule: 'duplicate', message: `"${key}" twice` });
      } else if (before !== undefined) {
        problems.push({ ...at, rule: 'collision', message: `"${key}" already means ${before}` });
      } else {
        said.set(`${entry.nodeId}\n${key}`, entry.optionId);
      }
    }
    for (const node of graph.nodes) {
      for (const option of optionsOf(node)) {
        if (!entries.some((e) => e.nodeId === node.id && e.optionId === option.id)) {
          problems.push({
            language,
            rule: 'uncovered',
            nodeId: node.id,
            optionId: option.id,
            message: 'no alias: the card cannot be typed in this language',
          });
        }
      }
    }
  }
  return problems;
}
