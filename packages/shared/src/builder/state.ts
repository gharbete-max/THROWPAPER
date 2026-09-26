import type { LocalisedText } from '../api/common.js';
import type { z } from 'zod';
import type { FormDefinition } from '../forms/definition.js';
import type { Json } from './graph/schema.js';

/**
 * What the guided builder holds while a conversation runs — `docs/plan/BUILDER-GRAPH.md`, "State
 * and paths", and `PREDICTIVE-BUILDER.md`, "The draft".
 *
 * The draft is the form itself: the same `FormDefinition` the editor, the renderer, the PDF and
 * the CSV read, plus the title. Everything else is the builder's own and is never published.
 */

export interface BuilderDraft {
  readonly definition: FormDefinition;
  readonly title: z.infer<typeof LocalisedText>;
}

/** The slots an import (S12) or an earlier answer can settle, which the conversation then skips. */
export type Slot = 'kind' | 'required' | 'options' | 'shape' | 'placement' | 'validation';

/**
 * Where one question came from, and what the builder knows about it that the form does not.
 *
 * Keyed by field id in the sidecar, never stored on the field: put on the definition, it would be
 * published into every version and every respondent's copy to answer a question only the author's
 * screen asks. Slice S5 adds the reconciliation baseline (`guided`, `proposal`) and S12 the import's
 * evidence (page, box, raw text, confidence, origin fingerprint).
 */
export interface FieldProvenance {
  readonly source: 'guided' | 'import' | 'manual';
  /** The node that made it, for a guided question. */
  readonly nodeId?: string;
  /** Slots already settled — what the `decided(slot)` guard reads. */
  readonly decided?: { readonly [slot in Slot]?: boolean };
  /**
   * What a change of type took off the question, kept so that changing back restores it: the
   * options somebody wrote survive a detour through "no, people type an answer". Never destroy
   * what a person wrote (`CLAUDE.md`, non-negotiable 4).
   */
  readonly setAside?: { readonly [property: string]: Json };
}

export interface BuilderSidecar {
  readonly provenance: 'guided' | 'import' | 'mixed';
  readonly fields: { readonly [fieldId: string]: FieldProvenance };
  /** Every question id this form has used. Never handed out again (`CAVEATS.md` #49). */
  readonly retiredIds: readonly string[];
  /** The answer to "Should this look like your organisation?", once given. */
  readonly brandDecided?: 'organisation' | 'default';
}

export interface Guess {
  readonly templateId: string;
  /** The top template's probability, in thousandths (S11). */
  readonly pMille: number;
}

export interface BuilderState {
  readonly draft: BuilderDraft;
  readonly sidecar: BuilderSidecar;
  /** The conversation's working memory: any JSON, never published. */
  readonly pending: { readonly [key: string]: Json };
  /** The id of the question being built, or null. */
  readonly focus: string | null;
  /** The belief engine's top guess (S11); null until there is one. */
  readonly guess: Guess | null;
  /** The node the conversation is at. */
  readonly cursor: string;
}

export type MachineErrorCode =
  /** The answer is not the kind this node takes, or names an option it does not have. */
  | 'wrong-answer'
  /** A number outside the node's range, or not a whole number. */
  | 'out-of-range'
  /** An empty answer to a node that needs one. */
  | 'empty-answer'
  /** The end has nothing to answer, and nothing before the first answer can be undone. */
  | 'nothing-to-do'
  /** A patch addresses `[focus]` while no question is in focus. */
  | 'no-focus'
  /** A patch addresses something that is not there. */
  | 'not-found'
  /** A patch would leave the draft something the form schema refuses. */
  | 'invalid-draft'
  /** A hand edit on a path the builder may not write, or with a value it may not hold. */
  | 'not-writable'
  /** Skipping nodes whose `when` is false went round without settling. */
  | 'no-node'
  /** A stored session this build cannot read. */
  | 'bad-session';

/**
 * Why the machine refused. The state it was given is unchanged — every function here returns a
 * new value or throws, never half of one.
 */
export class MachineError extends Error {
  constructor(
    readonly code: MachineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MachineError';
  }
}
