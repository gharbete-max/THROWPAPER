import type { Json } from '../builder/graph/schema.js';
import type { Tier } from '../builder/machine.js';

/**
 * What the ladder makes of free text — `docs/plan/INTENT-LADDER.md`, "The contract".
 */

export interface Alternative {
  readonly nodeId: string;
  readonly optionId: string | null;
  readonly confidence: number;
}

export interface Reading {
  /** The node it answers: the one asked, or — T5, T6, T7 — another of its group. */
  readonly nodeId: string;
  /** Null for a quantity or a list. */
  readonly optionId: string | null;
  /** The quantity, or the list's labels (T6); null for an option. */
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
 * quantity; `vague` — "some", "några"; `out-of-range` — a number (or a list) the node does not
 * allow; `budget` — the comparison budget ran out; `too-long` — more than a phrase, and not a
 * list; `not-readable` — a node free text does not answer (text entry, preview, menu).
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

/** A clause of a sentence that answered several questions (T5), which answered none of them. */
export interface Unused {
  readonly span: readonly [number, number];
  /** `nothing`: it read as no answer; `conflict`: it said something another clause contradicted. */
  readonly why: 'nothing' | 'conflict';
}

export type Interpretation =
  /** T0–T4 for the node asked; T6 for the node the list answers. */
  | { readonly outcome: 'apply'; readonly reading: Reading }
  /** T5: several questions answered at once, in the graph's order, and what went unused. */
  | {
      readonly outcome: 'fill';
      readonly readings: readonly Reading[];
      readonly unused: readonly Unused[];
    }
  /** T7: nothing fits the question asked, but one of its group clearly does — to be confirmed. */
  | { readonly outcome: 'guess'; readonly reading: Reading }
  /**
   * T8: the node's own options, most likely first; and, when something fitted another question of
   * the group without being clear enough to guess (T7), up to three of those questions.
   */
  | {
      readonly outcome: 'ask';
      readonly reason: AskReason;
      readonly options: readonly Reading[];
      readonly elsewhere: readonly Alternative[];
    };

export function ask(
  reason: AskReason,
  options: readonly Reading[],
  elsewhere: readonly Alternative[] = [],
): Interpretation {
  return { outcome: 'ask', reason, options, elsewhere };
}
