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

interface Ordered {
  readonly locale: string;
  readonly nodeId: string;
  readonly optionId: string;
  readonly phrase: string;
}

/** The alias file's order: language, question, answer, phrase — code points, not a collation. */
export const compareAliases = (a: Ordered, b: Ordered): number =>
  compareCodePoints(a.locale, b.locale) ||
  compareCodePoints(a.nodeId, b.nodeId) ||
  compareCodePoints(a.optionId, b.optionId) ||
  compareCodePoints(a.phrase, b.phrase);

/** By locale, node, option and phrase, in code-point order. */
export function sortEntries(entries: readonly AliasEntry[]): AliasEntry[] {
  return [...entries].sort(compareAliases);
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

// --- Learned aliases (S6) ------------------------------------------------------------------------

/**
 * Why a phrase cannot be learned as a way of saying an option (`INTENT-LADDER.md`, "Aliases"):
 * `present` — it already says exactly that; `collision` — it already says another option of the
 * node (`means` names which), built in or learned, and learned never overrides; `shadows-id` — it
 * is another option's id; `empty` — it normalises to nothing; `too-long` — over 80 characters;
 * `unknown-node`, `unknown-option` — the graph has no such thing.
 */
export type AliasRefusalReason =
  'present' | 'collision' | 'shadows-id' | 'empty' | 'too-long' | 'unknown-node' | 'unknown-option';

export interface AliasRefusal {
  readonly reason: AliasRefusalReason;
  /** For `collision`: the option the phrase already means. */
  readonly means?: string;
}

/** What a person asks Loppa to remember: the phrase, and the answer it is a way of saying. */
export const RememberAlias = z
  .object({
    phrase: AliasEntry.shape.phrase,
    nodeId: z.string().min(1),
    optionId: z.string().min(1),
    locale: z.enum(LANGUAGES),
  })
  .strict();
export type RememberAlias = z.infer<typeof RememberAlias>;

/**
 * Whether a phrase can be learned, against the graph and every alias already known in its
 * language — the built-in ones and the organisation's. Null when it can.
 */
export function aliasRefusal(
  graph: BuilderGraph,
  wanted: RememberAlias,
  known: readonly AliasEntry[],
): AliasRefusal | null {
  if ([...wanted.phrase].length > 80) return { reason: 'too-long' };
  const node = graph.nodes.find((n) => n.id === wanted.nodeId);
  if (!node) return { reason: 'unknown-node' };
  const options = optionsOf(node);
  if (!options.some((o) => o.id === wanted.optionId)) return { reason: 'unknown-option' };
  const key = keyOf(wanted.phrase);
  if (key === '') return { reason: 'empty' };
  const id = options.find((o) => keyOf(o.id) === key);
  if (id) return id.id === wanted.optionId ? { reason: 'present' } : { reason: 'shadows-id' };
  const said = known.find(
    (e) => e.locale === wanted.locale && e.nodeId === wanted.nodeId && keyOf(e.phrase) === key,
  );
  if (!said) return null;
  return said.optionId === wanted.optionId
    ? { reason: 'present' }
    : { reason: 'collision', means: said.optionId };
}

/** Whether a stored alias still names something in the graph; one that does not is inert. */
export function aliasInert(graph: BuilderGraph, entry: AliasEntry): boolean {
  const node = graph.nodes.find((n) => n.id === entry.nodeId);
  return !node || !optionsOf(node).some((o) => o.id === entry.optionId);
}

export interface AliasImportDiff {
  /** New, and to be stored with `source: 'imported'`. */
  readonly added: readonly AliasEntry[];
  /** Already known, saying the same thing: nothing to do. */
  readonly present: readonly AliasEntry[];
  /** Not to be stored, and why. */
  readonly refused: readonly (AliasRefusal & { readonly entry: AliasEntry })[];
}

/**
 * What importing an alias file would do — shown before anything is stored, and stored only when
 * confirmed (`CLAUDE.md` rule 7). Each entry is checked as if the ones before it in the file had
 * been added, so a file that says one phrase two ways adds the first and refuses the second.
 * `today` is the date an added entry is stamped with, `YYYY-MM-DD`: the core reads no clock.
 */
export function aliasImportDiff(
  graph: BuilderGraph,
  file: AliasFile,
  known: readonly AliasEntry[],
  today: string,
): AliasImportDiff {
  const added: AliasEntry[] = [];
  const present: AliasEntry[] = [];
  const refused: (AliasRefusal & { entry: AliasEntry })[] = [];
  for (const entry of sortEntries(file.entries)) {
    const refusal = aliasRefusal(graph, entry, [...known, ...added]);
    if (refusal?.reason === 'present') present.push(entry);
    else if (refusal) refused.push({ ...refusal, entry });
    else added.push({ ...entry, source: 'imported', createdAt: today, count: 1 });
  }
  return { added, present, refused };
}

// --- The learned aliases' endpoints (Forms-internal; not `CONTRACT.md`) -------------------------

const REFUSALS = [
  'present',
  'collision',
  'shadows-id',
  'empty',
  'too-long',
  'unknown-node',
  'unknown-option',
] as const satisfies readonly AliasRefusalReason[];

/** At most this many entries in one imported file. */
export const MAX_IMPORTED_ALIASES = 5_000;

/** A learned alias as `GET /v1/builder/aliases` lists it: the entry, and its id. */
export const LearnedAlias = AliasEntry.extend({ id: z.string().uuid() });
export type LearnedAlias = z.infer<typeof LearnedAlias>;

export const LearnedAliasList = z.object({ aliases: z.array(LearnedAlias) }).strict();
export type LearnedAliasList = z.infer<typeof LearnedAliasList>;

/** `POST /v1/builder/aliases`: stored — or, remembered again, counted once more. */
export const RememberedAlias = z.object({ alias: LearnedAlias, created: z.boolean() }).strict();
export type RememberedAlias = z.infer<typeof RememberedAlias>;

/** 409 from `POST /v1/builder/aliases`: why the phrase cannot mean that. */
export const AliasRefusedResponse = z
  .object({
    error: z
      .object({
        code: z.literal('alias-refused'),
        message: z.string(),
        reason: z.enum(REFUSALS),
        means: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type AliasRefusedResponse = z.infer<typeof AliasRefusedResponse>;

/** `POST /v1/builder/aliases/import`: a file, to see what it would do — or to do it. */
export const ImportAliases = z.object({ file: z.unknown(), confirm: z.boolean() }).strict();
export type ImportAliases = z.infer<typeof ImportAliases>;

export const AliasImportResult = z
  .object({
    added: z.array(AliasEntry),
    present: z.array(AliasEntry),
    refused: z.array(
      z
        .object({ entry: AliasEntry, reason: z.enum(REFUSALS), means: z.string().optional() })
        .strict(),
    ),
    /** False for a preview: nothing was stored until the import is confirmed. */
    stored: z.boolean(),
  })
  .strict();
export type AliasImportResult = z.infer<typeof AliasImportResult>;

export const AliasesRemoved = z.object({ removed: z.number().int().min(0) }).strict();
export type AliasesRemoved = z.infer<typeof AliasesRemoved>;
