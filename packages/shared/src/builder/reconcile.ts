import type { Field } from '../forms/definition.js';
import { applyChange, inverseOf, jsonEqual, type Change, type Pointer } from './changes.js';
import type { Json } from './graph/schema.js';
import type { BuilderState } from './state.js';

/**
 * Reconciliation — `PREDICTIVE-BUILDER.md`, "Reconciliation: the rule everyone forgets".
 *
 * Every guided step records, for each question it made or changed, the question as it left it:
 * the sidecar's `guided` baseline. A question that differs from its baseline **has been changed by
 * hand** — on the preview or in the classic editor; the comparison does not care where.
 *
 * A guided step never changes such a question. It works out what it would have made of it, as if
 * the question were still the conversation's own, and keeps that as the question's `proposal`; the
 * draft keeps the person's version. The proposal waits for Keep mine or Use guided, and later
 * steps go on building it, so the conversation can carry on without ever writing over a hand edit.
 * Nothing here is ever clobbered (non-negotiable 4).
 */

const FIELDS: Pointer = ['draft', 'definition', 'fields'];

export const fieldPointer = (id: string): Pointer => [...FIELDS, { id }];
export const provenancePointer = (id: string, ...key: string[]): Pointer => [
  'sidecar',
  'fields',
  id,
  ...key,
];

const asJson = (value: object): Json => value as unknown as Json;

export function fieldOf(state: BuilderState, id: string): Field | undefined {
  return state.draft.definition.fields.find((field) => field.id === id);
}

/** Whether a question differs from the one the conversation last left: changed by hand. */
export function changedByHand(state: BuilderState, fieldId: string): boolean {
  const guided = state.sidecar.fields[fieldId]?.guided;
  const field = fieldOf(state, fieldId);
  return guided !== undefined && field !== undefined && !jsonEqual(field, guided);
}

/** The questions whose guided change is waiting for Keep mine or Use guided, in form order. */
export function proposals(state: BuilderState): string[] {
  return state.draft.definition.fields
    .filter((field) => state.sidecar.fields[field.id]?.proposal !== undefined)
    .map((field) => field.id);
}

/** Changes applied one by one, each inverse taken against the state it applies to. */
export interface Tracked {
  readonly changes: Change[];
  /** Last change first: applying them in order undoes everything. */
  inverse: Change[];
}

export function applyTracked(state: BuilderState, changes: readonly Change[], into: Tracked) {
  let here = state;
  for (const change of changes) {
    const undo = inverseOf(here, change);
    here = applyChange(here, change);
    into.changes.push(change);
    if (undo) into.inverse.unshift(undo);
  }
  return here;
}

/**
 * Before a guided step: each question with a proposal shows the conversation its own version, so
 * the step builds on what the conversation made rather than on the person's edit.
 */
export function guidedView(state: BuilderState, into: Tracked): BuilderState {
  const swaps: Change[] = proposals(state).map((id) => ({
    op: 'set',
    at: fieldPointer(id),
    value: state.sidecar.fields[id]!.proposal!,
  }));
  return applyTracked(state, swaps, into);
}

/**
 * After a guided step: which questions it may change, and the record of what it did.
 *
 * - A question with a proposal, or one changed by hand that the step touched, keeps the person's
 *   version in the draft; what the step made of it becomes (or stays) its proposal — unless that
 *   now equals the person's version, when the two agree and there is nothing left to ask.
 * - Any other question the step made or changed is the conversation's: its baseline is recorded.
 *
 * `before` is the state before the step (the person's versions in the draft), `view` the state the
 * step ran on, `after` what it produced.
 */
export function settleQuestions(
  before: BuilderState,
  view: BuilderState,
  after: BuilderState,
): Change[] {
  const waiting = new Set(proposals(before));
  const changes: Change[] = [];
  for (const field of after.draft.definition.fields) {
    const id = field.id;
    const was = fieldOf(view, id);
    const touched = was === undefined || !jsonEqual(was, field);
    const mine = fieldOf(before, id);
    const held = waiting.has(id) || (touched && changedByHand(before, id));

    if (held && mine) {
      changes.push({ op: 'set', at: fieldPointer(id), value: asJson(mine) });
      if (jsonEqual(mine, field)) {
        // The conversation has come round to the person's version: nothing is left to ask.
        changes.push({ op: 'set', at: provenancePointer(id, 'guided'), value: asJson(field) });
        changes.push({ op: 'unset', at: provenancePointer(id, 'proposal') });
      } else if (!jsonEqual(after.sidecar.fields[id]?.proposal, field)) {
        changes.push({ op: 'set', at: provenancePointer(id, 'proposal'), value: asJson(field) });
      }
      continue;
    }
    if (!touched) continue;
    changes.push(
      after.sidecar.fields[id]
        ? { op: 'set', at: provenancePointer(id, 'guided'), value: asJson(field) }
        : // A question the conversation never made (the editor's) that a step now changes.
          {
            op: 'set',
            at: provenancePointer(id),
            value: asJson({ source: 'manual', guided: field }),
          },
    );
  }
  return changes;
}
