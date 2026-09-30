import { optionsOf, type BuilderGraph } from '../builder/graph/schema.js';
import { BUILTIN_ALIASES, type AliasEntry } from './aliases.js';
import { lexiconFor, type Language, type Lexicon } from './lexicon.js';
import { lnMille } from './ln.js';
import { compareCodePoints, keyOf, phraseTokens } from './text.js';

/**
 * What the ladder reads against in one language: each node's options with their aliases already
 * normalised, and T2's keyword weights. Built from the alias entries in a fixed order — options as
 * the graph declares them, aliases by phrase — so the same aliases in any order give the same
 * vocabulary, and the same answers.
 */

export interface Word {
  readonly text: string;
  readonly folded: string;
  readonly cjk: boolean;
}

export interface AliasForm {
  readonly phrase: string;
  /** As T0 compares it (`keyOf`). */
  readonly key: string;
  /** Every token, for "the input's other tokens". */
  readonly tokens: ReadonlySet<string>;
  /** The words that must be matched: its tokens that are not stop words (all of them, if none). */
  readonly content: readonly Word[];
  /**
   * It says a negator ("no buttons", "not required", `不要按钮`), so its words match only in its
   * own order: "buttons no" is not "no buttons". Every other alias matches in any order.
   */
  readonly ordered: boolean;
}

export interface OptionWords {
  readonly optionId: string;
  readonly aliases: readonly AliasForm[];
}

export interface NodeWords {
  readonly nodeId: string;
  /** In the graph's order, each with its aliases (possibly none). */
  readonly options: readonly OptionWords[];
  /** An option's id, as T0 compares it, to the option. */
  readonly ids: ReadonlyMap<string, string>;
  /** "Negation is honoured": the words of every option but the `negative` one. */
  readonly keywords: readonly Word[];
}

export interface Vocabulary {
  readonly language: Language;
  readonly lexicon: Lexicon;
  readonly nodes: ReadonlyMap<string, NodeWords>;
  /** T2: `round(1000 × ln(N / df))` per content word; N options have aliases in this language. */
  readonly weights: ReadonlyMap<string, number>;
}

function formOf(phrase: string, lexicon: Lexicon): AliasForm {
  const tokens = phraseTokens(phrase);
  const content = tokens.filter((t) => !lexicon.stopWords.has(t.text));
  const words = (content.length > 0 ? content : tokens).map((t) => ({
    text: t.text,
    folded: t.folded,
    cjk: t.cjk,
  }));
  const lower = phrase.normalize('NFKC').toLowerCase();
  const ordered = lexicon.negators.some((n) =>
    n.cjk ? lower.includes(n.text) : words.some((w) => w.text === n.tokens[0]),
  );
  return {
    phrase,
    key: keyOf(phrase),
    tokens: new Set(tokens.map((t) => t.text)),
    content: words,
    ordered,
  };
}

function build(
  graph: BuilderGraph,
  language: Language,
  entries: readonly AliasEntry[],
): Vocabulary {
  const lexicon = lexiconFor(language);
  const mine = entries.filter((e) => e.locale === language);
  const nodes = new Map<string, NodeWords>();
  const optionWords: Set<string>[] = [];
  for (const node of graph.nodes) {
    const options = optionsOf(node);
    if (options.length === 0) continue;
    const words: OptionWords[] = options.map((option) => {
      const phrases = [
        ...new Set(
          mine.filter((e) => e.nodeId === node.id && e.optionId === option.id).map((e) => e.phrase),
        ),
      ].sort(compareCodePoints);
      const forms: AliasForm[] = [];
      const keys = new Set<string>();
      for (const phrase of phrases) {
        const form = formOf(phrase, lexicon);
        if (form.key === '' || keys.has(form.key)) continue;
        keys.add(form.key);
        forms.push(form);
      }
      if (forms.length > 0)
        optionWords.push(new Set(forms.flatMap((f) => f.content.map((w) => w.text))));
      return { optionId: option.id, aliases: forms };
    });
    const keywords = new Map<string, Word>();
    for (const option of words) {
      if (option.optionId === node.negative) continue;
      for (const form of option.aliases) for (const w of form.content) keywords.set(w.text, w);
    }
    nodes.set(node.id, {
      nodeId: node.id,
      options: words,
      ids: new Map(options.map((o) => [keyOf(o.id), o.id])),
      keywords: [...keywords.values()].sort((a, b) => compareCodePoints(a.text, b.text)),
    });
  }
  const df = new Map<string, number>();
  for (const set of optionWords) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const N = optionWords.length;
  const weights = new Map([...df].map(([w, count]) => [w, lnMille(N, count)] as const));
  return { language, lexicon, nodes, weights };
}

const CACHE = new WeakMap<
  readonly AliasEntry[],
  WeakMap<BuilderGraph, Map<Language, Vocabulary>>
>();

/** The vocabulary of a graph in a language, from these aliases (the built-in ones by default). */
export function vocabularyFor(
  graph: BuilderGraph,
  language: Language,
  entries: readonly AliasEntry[] = BUILTIN_ALIASES,
): Vocabulary {
  let byGraph = CACHE.get(entries);
  if (!byGraph) CACHE.set(entries, (byGraph = new WeakMap()));
  let byLanguage = byGraph.get(graph);
  if (!byLanguage) byGraph.set(graph, (byLanguage = new Map()));
  let vocabulary = byLanguage.get(language);
  if (!vocabulary) byLanguage.set(language, (vocabulary = build(graph, language, entries)));
  return vocabulary;
}
