import type { BuilderGraph, Json, Node } from '../builder/graph/schema.js';
import type { Answer, Tier } from '../builder/machine.js';
import type { AliasEntry } from './aliases.js';
import { fuzzyMatch } from './fuzzy.js';
import { languageOf, occurrences, type Lexicon, type Occurrence } from './lexicon.js';
import { readQuantity } from './patterns.js';
import { probed, tokenise, type Probed, type Token } from './text.js';
import { vocabularyFor, type NodeWords, type Vocabulary, type Word } from './vocabulary.js';

/**
 * The ladder — free text read by rules, cheapest and surest first (`docs/plan/INTENT-LADDER.md`,
 * ADR 0019). This is S3's part of it: T0 exact, T1 tokens, T2 weighted keywords, T3 fuzzy, T4
 * values, with negation and "no number from vagueness" on every rung. The first rung that clears
 * its threshold wins; below every threshold the answer is to ask, and nothing is applied.
 *
 * Pure, and integers throughout: the same input and the same aliases give the same reading on
 * every machine. Fuzzy work is capped by counting comparisons, not by a clock, so the cut-off is
 * the same on a slow machine as on a fast one.
 */

/** T2 and T3 accept at this many per mille. */
export const THRESHOLD = 720;
/** T2: the runner-up must be at least this far below. */
export const MARGIN = 150;
/** T2's confidence is capped here: a weighted partial read is never surer than T1's tight one. */
export const T2_CEILING = 850;
/** Fuzzy comparisons one reading may make (CAVEATS #42: interpretation within 10 ms). */
export const COMPARISON_BUDGET = 20_000;
/** Longer input is not a phrase; a pasted list is S6's (T6). */
export const MAX_INPUT = 500;
/** T1 and T3: words besides the alias's that are not stop words. */
const OTHER_TOKENS = 2;

export interface Alternative {
  readonly nodeId: string;
  readonly optionId: string | null;
  readonly confidence: number;
}

export interface Reading {
  readonly nodeId: string;
  /** Null for a quantity. */
  readonly optionId: string | null;
  /** The quantity; null for an option. */
  readonly value: Json | null;
  /** Per mille, 0–1000. */
  readonly confidence: number;
  readonly tier: Tier;
  /** UTF-16 offsets into the input: what decided it. */
  readonly evidenceSpan: readonly [number, number];
  /** At most three: what "change" offers first. */
  readonly alternatives: readonly Alternative[];
}

/**
 * Why the ladder asked. `nothing` — nothing matched; `ambiguous` — two options (or two numbers)
 * matched equally; `negated` — a negated keyword on a node with no `negative` option, or on a
 * quantity; `vague` — "some", "några"; `out-of-range` — a number the node does not allow;
 * `budget` — the comparison budget ran out; `too-long` — more than `MAX_INPUT`; `not-readable` —
 * a node free text does not answer in S3 (text entry, preview, menu).
 */
export type AskReason =
  | 'nothing'
  | 'ambiguous'
  | 'negated'
  | 'vague'
  | 'out-of-range'
  | 'budget'
  | 'too-long'
  | 'not-readable';

export type Interpretation =
  | { readonly outcome: 'apply'; readonly reading: Reading }
  /** The node's own options, most likely first (tier T8); S6 widens this to the group. */
  | { readonly outcome: 'ask'; readonly reason: AskReason; readonly options: readonly Reading[] };

export interface InterpretContext {
  readonly graph: BuilderGraph;
  readonly nodeId: string;
  /** The author's interface language, e.g. `sv-SE`. */
  readonly locale: string;
  /** The built-in aliases by default; S6 adds the organisation's learned ones. */
  readonly aliases?: readonly AliasEntry[];
}

/** How a chip under the node words the reading (`INTENT-LADDER.md`, "The contract"). */
export function chipOf(tier: Tier): 'understood' | 'think' | 'asked' {
  if (tier === 'T0' || tier === 'T1' || tier === 'T2' || tier === 'T3') return 'understood';
  return tier === 'T8' ? 'asked' : 'think';
}

/** The answer a reading gives the machine; pass `reading.tier` as the answer's tier. */
export function toAnswer(graph: BuilderGraph, reading: Reading): Answer {
  const node = graph.nodes.find((n) => n.id === reading.nodeId);
  if (node?.kind === 'quantity') return { kind: 'quantity', value: reading.value as number };
  if (node?.kind === 'pick-many') return { kind: 'options', optionIds: [reading.optionId!] };
  return { kind: 'option', optionId: reading.optionId! };
}

class BudgetSpent extends Error {}

/** Counts fuzzy comparisons; throws when the budget is spent. */
class Budget {
  private left = COMPARISON_BUDGET;
  match(a: string, b: string): boolean {
    if (this.left <= 0) throw new BudgetSpent();
    this.left -= 1;
    return fuzzyMatch(a, b);
  }
}

/** Free text at a node, read. Pure and total: every input gets an interpretation. */
export function interpret(input: string, context: InterpretContext): Interpretation {
  const node = context.graph.nodes.find((n) => n.id === context.nodeId);
  const language = languageOf(context.locale);
  if (!node || !language) return ask('not-readable', []);
  if (input.length > MAX_INPUT) return ask('too-long', []);
  const vocabulary = vocabularyFor(context.graph, language, context.aliases);
  if (node.kind === 'quantity') return readAmount(input, node, vocabulary.lexicon);
  const words = vocabulary.nodes.get(node.id);
  if (!words || !('options' in node)) return ask('not-readable', []);
  try {
    return readOption(input, node, words, vocabulary);
  } catch (error) {
    if (!(error instanceof BudgetSpent)) throw error;
    return ask('budget', ranked(node.id, words, new Map()).slice(0, 6));
  }
}

function ask(reason: AskReason, options: readonly Reading[]): Interpretation {
  return { outcome: 'ask', reason, options };
}

// --- T4: a quantity ----------------------------------------------------------------------------

function readAmount(
  input: string,
  node: Extract<Node, { kind: 'quantity' }>,
  lexicon: Lexicon,
): Interpretation {
  const read = readQuantity(input, lexicon);
  if ('refused' in read) return ask(read.refused, []);
  if (read.value < node.min || read.value > node.max) return ask('out-of-range', []);
  return {
    outcome: 'apply',
    reading: {
      nodeId: node.id,
      optionId: null,
      value: read.value,
      confidence: read.whole ? 850 : 750,
      tier: 'T4',
      evidenceSpan: [read.start, read.end],
      alternatives: [],
    },
  };
}

// --- T0–T3: an option --------------------------------------------------------------------------

interface Scored extends Evidence {
  readonly score: number;
}

interface Input {
  readonly p: Probed;
  readonly tokens: readonly Token[];
  /** A word's first token, by primary and by folded form. */
  readonly primary: ReadonlyMap<string, number>;
  readonly folded: ReadonlyMap<string, number>;
  readonly stop: (i: number) => boolean;
  readonly negators: readonly Occurrence[];
  /**
   * The stretch of the sentence each token is in: its clause, cut again at every contrast word
   * ("not text but buttons"). A negator reaches only as far as its stretch.
   */
  readonly stretch: readonly string[];
  readonly stretchAt: (clause: number, at: number) => string;
}

function inputOf(text: string, lexicon: Lexicon): Input {
  const p = probed(text);
  const tokens = tokenise(p);
  const primary = new Map<string, number>();
  const folded = new Map<string, number>();
  tokens.forEach((token, i) => {
    if (!primary.has(token.text)) primary.set(token.text, i);
    if (!folded.has(token.folded)) folded.set(token.folded, i);
  });
  const contrast = occurrences(lexicon.contrast, p, tokens);
  const stretchAt = (clause: number, at: number) =>
    `${clause}:${contrast.filter((c) => c.clause === clause && c.end <= at).length}`;
  return {
    p,
    tokens,
    primary,
    folded,
    stop: (i) => lexicon.stopWords.has(tokens[i]!.text),
    negators: occurrences(lexicon.negators, p, tokens),
    stretch: tokens.map((t) => stretchAt(t.clause, t.start)),
    stretchAt,
  };
}

/** A negator in the stretch of a reading's words that is not itself one of them. */
function strayNegator(input: Input, matched: readonly number[]): boolean {
  const reach = new Set(matched.map((i) => input.stretch[i]));
  const span = spanOver(input.tokens, matched);
  return input.negators.some((negator) => {
    if (!reach.has(input.stretchAt(negator.clause, negator.start))) return false;
    const inside =
      negator.tokens.length > 0
        ? negator.tokens.every((i) => matched.includes(i))
        : negator.start >= span[0] && negator.end <= span[1];
    return !inside;
  });
}

function spanOver(tokens: readonly Token[], indices: readonly number[]): [number, number] {
  let start = Infinity;
  let end = -Infinity;
  for (const i of indices) {
    start = Math.min(start, tokens[i]!.start);
    end = Math.max(end, tokens[i]!.end);
  }
  return [start, end];
}

/** Tokens outside `matched` that are not stop words. */
function othersBesides(input: Input, matched: readonly number[]): number {
  const used = new Set(matched);
  let others = 0;
  input.tokens.forEach((_, i) => {
    if (!used.has(i) && !input.stop(i)) others += 1;
  });
  return others;
}

/** The node's options, most likely first by T2's score, then in the graph's order. */
function ranked(nodeId: string, words: NodeWords, scores: ReadonlyMap<string, Scored>): Reading[] {
  return words.options
    .map((option, order) => ({ option, order, scored: scores.get(option.optionId) }))
    .sort((a, b) => (b.scored?.score ?? 0) - (a.scored?.score ?? 0) || a.order - b.order)
    .map(({ option, scored }) => ({
      nodeId,
      optionId: option.optionId,
      value: null,
      confidence: scored?.score ?? 0,
      tier: 'T8' as const,
      evidenceSpan: scored?.span ?? ([0, 0] as const),
      alternatives: [],
    }));
}

function readOption(
  text: string,
  node: Node,
  words: NodeWords,
  vocabulary: Vocabulary,
): Interpretation {
  const { lexicon } = vocabulary;
  const input = inputOf(text, lexicon);
  const { tokens } = input;
  const budget = new Budget();
  const scores = t2(input, words, vocabulary.weights);
  const menu = () => ranked(node.id, words, scores).slice(0, 6);
  const apply = (
    optionId: string,
    confidence: number,
    tier: Tier,
    span: readonly [number, number],
  ): Interpretation => ({
    outcome: 'apply',
    reading: {
      nodeId: node.id,
      optionId,
      value: null,
      confidence,
      tier,
      evidenceSpan: span,
      alternatives: ranked(node.id, words, scores)
        .filter((r) => r.optionId !== optionId)
        .slice(0, 3)
        .map((r) => ({ nodeId: r.nodeId, optionId: r.optionId, confidence: r.confidence })),
    },
  });

  if (tokens.length === 0) return ask('nothing', menu());
  const whole = spanOver(
    tokens,
    tokens.map((_, i) => i),
  );

  // T0 — the whole input is an option's id, or one option's alias.
  const key = tokens.map((t) => t.text).join(' ');
  const byId = words.ids.get(key);
  if (byId) return apply(byId, 1000, 'T0', whole);
  const exact = words.options.filter((o) => o.aliases.some((a) => a.key === key));
  if (exact.length === 1) return apply(exact[0]!.optionId, 1000, 'T0', whole);

  // Negation, before anything could read the negated word as the option it names.
  const negated = negation(input, words, budget);
  if (negated) {
    return node.negative
      ? apply(node.negative, negated.confidence, negated.tier, negated.span)
      : ask('negated', menu());
  }
  // A negator the rule above left alone, beside a reading's words and not one of them, may still
  // be meant for them — "knapper er ikke nødvendigt" — so such a reading is asked, not applied.
  const read = (optionId: string, score: number, tier: Tier, match: Evidence) =>
    strayNegator(input, match.matched)
      ? ask('negated', menu())
      : apply(optionId, score, tier, match.span!);

  // T1 — every word of one option's alias, and little else. When two options match, the one whose
  // words include all of every other's explains more of what was typed: "det krävs inte" is "not
  // required" rather than "required"; "yes buttons no text" points both ways, and is asked.
  const t1Found = aliasMatches(input, words, budget, false);
  const widest = t1Found.find((m) =>
    t1Found.every(
      (o) =>
        o === m ||
        (o.matched.every((i) => m.matched.includes(i)) && o.matched.length < m.matched.length),
    ),
  );
  if (widest) return read(widest.optionId, widest.score, 'T1', widest);

  // T2 — the rare words of one option's alias, well ahead of any other option.
  const t2Order = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [best, second] = t2Order;
  if (best && best[1].score >= THRESHOLD && (second?.[1].score ?? 0) <= best[1].score - MARGIN) {
    return read(best[0], Math.min(best[1].score, T2_CEILING), 'T2', best[1]);
  }

  // T3 — the same as T1, allowing a misspelt word or one.
  const t3Found = aliasMatches(input, words, budget, true).filter((m) => m.score >= THRESHOLD);
  if (t3Found.length === 1) {
    const [only] = t3Found;
    return read(only!.optionId, only!.score, 'T3', only!);
  }

  const ambiguous =
    t1Found.length > 1 || t3Found.length > 1 || (best !== undefined && best[1].score >= THRESHOLD);
  return ask(ambiguous ? 'ambiguous' : 'nothing', menu());
}

/** The input tokens a reading rests on, and their span. */
interface Evidence {
  readonly span: readonly [number, number] | null;
  readonly matched: readonly number[];
}

interface Match extends Evidence {
  readonly optionId: string;
  readonly score: number;
  readonly span: readonly [number, number];
  /** Every input token a matching alias of the option matched: all that points at it. */
  readonly matched: readonly number[];
}

/**
 * T1 (`fuzzy` false) or T3 (`fuzzy` true): options with an alias whose every word is in the
 * input — exactly (900), on the folded form (850), or, for T3, fuzzily (100 less for each) —
 * with at most two other words that are not stop words. The best alias per option.
 */
function aliasMatches(input: Input, words: NodeWords, budget: Budget, fuzzy: boolean): Match[] {
  const found: Match[] = [];
  for (const option of words.options) {
    let best: Omit<Match, 'matched'> | null = null;
    const all = new Set<number>();
    for (const alias of option.aliases) {
      const matched: number[] = [];
      let folded = false;
      let misspelt = 0;
      for (const word of alias.content) {
        let at = input.primary.get(word.text);
        if (at === undefined) {
          at = input.folded.get(word.folded);
          if (at !== undefined) folded = true;
        }
        if (at === undefined && fuzzy && !word.cjk) {
          at = input.tokens.findIndex(
            (t, i) =>
              !t.cjk &&
              !/^\d+$/.test(t.text) &&
              !input.stop(i) &&
              budget.match(t.folded, word.folded),
          );
          if (at < 0) at = undefined;
          else misspelt += 1;
        }
        if (at === undefined) break;
        matched.push(at);
      }
      if (matched.length < alias.content.length) continue;
      if (alias.ordered && !increasing(matched)) continue;
      if (othersBesides(input, matched) > OTHER_TOKENS) continue;
      const score = 900 - (folded ? 50 : 0) - 100 * misspelt;
      matched.forEach((i) => all.add(i));
      if (!best || score > best.score) {
        best = { optionId: option.optionId, score, span: spanOver(input.tokens, matched) };
      }
    }
    if (best) found.push({ ...best, matched: [...all].sort((a, b) => a - b) });
  }
  return found;
}

/**
 * T2: each option's best alias by the weighted share of its words in the input — `1000 × Σ
 * matched weights ÷ Σ all weights`, integer division, 50 less if a word matched only folded.
 */
function t2(input: Input, words: NodeWords, weights: ReadonlyMap<string, number>) {
  const scores = new Map<string, Scored>();
  for (const option of words.options) {
    let best: Scored = { score: 0, span: null, matched: [] };
    for (const alias of option.aliases) {
      let total = 0;
      let got = 0;
      let folded = false;
      const matched: number[] = [];
      for (const word of alias.content) {
        const weight = weights.get(word.text) ?? 0;
        total += weight;
        let at = input.primary.get(word.text);
        if (at === undefined) {
          at = input.folded.get(word.folded);
          if (at !== undefined) folded = true;
        }
        if (at !== undefined) {
          got += weight;
          matched.push(at);
        }
      }
      if (total === 0 || matched.length === 0) continue;
      if (alias.ordered && !increasing(matched)) continue;
      const share = (1000 * got - ((1000 * got) % total)) / total;
      const score = Math.max(0, share - (folded ? 50 : 0));
      if (score > best.score) best = { score, span: spanOver(input.tokens, matched), matched };
    }
    scores.set(option.optionId, best);
  }
  return scores;
}

/**
 * "Negation is honoured": a negator and, in the same stretch of the sentence, a word of one of the
 * node's options other than its `negative` one — exactly (T1), folded (T1, 850) or misspelt (T3,
 * 800). A stretch ends at a clause's end or at a contrast word ("not text but buttons").
 *
 * The word comes after the negator ("no buttons", "utan knappar"), or before it when the negator
 * ends the stretch — Swedish and German say "knappar behövs inte", "Buttons brauche ich nicht".
 * Otherwise a negator between two words negates neither: "yes buttons no text" is asked, not read.
 * In Chinese and Japanese the negator may stand on either side (`不要按钮`, `ボタンなし`).
 */
function negation(
  input: Input,
  words: NodeWords,
  budget: Budget,
): { tier: Tier; confidence: number; span: [number, number] } | null {
  const primary = new Set(words.keywords.map((w) => w.text));
  const folded = new Set(words.keywords.map((w) => w.folded));
  const latin = words.keywords.filter((w) => !w.cjk);
  const { tokens, stretch } = input;
  for (const negator of input.negators) {
    const here = input.stretchAt(negator.clause, negator.start);
    const last = negator.tokens.length > 0 ? Math.max(...negator.tokens) : -1;
    const first = negator.tokens.length > 0 ? Math.min(...negator.tokens) : -1;
    const final = tokens.every((_, i) => i <= last || stretch[i] !== here || input.stop(i));
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      if (stretch[i] !== here || input.stop(i)) continue;
      if (negator.tokens.length === 0) {
        if (overlaps(token, negator)) continue;
      } else if (!(i > last || (final && i < first))) continue;
      let hit: { tier: Tier; confidence: number } | null = null;
      if (primary.has(token.text)) hit = { tier: 'T1', confidence: 900 };
      else if (folded.has(token.folded)) hit = { tier: 'T1', confidence: 850 };
      else if (!token.cjk && latin.some((w: Word) => budget.match(token.folded, w.folded))) {
        hit = { tier: 'T3', confidence: 800 };
      }
      if (hit) {
        return {
          ...hit,
          span: [Math.min(negator.start, token.start), Math.max(negator.end, token.end)],
        };
      }
    }
  }
  return null;
}

const overlaps = (token: Token, span: { start: number; end: number }) =>
  token.start < span.end && span.start < token.end;

const increasing = (indices: readonly number[]) =>
  indices.every((v, i) => i === 0 || v > indices[i - 1]!);
