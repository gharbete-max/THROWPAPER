import type { z } from 'zod';
import type { Field, SelectOption } from '../forms/definition.js';
import { V } from '../forms/vocabulary.js';
import {
  applyChange,
  get,
  identityOf,
  inverseOf,
  jsonEqual,
  type Change,
  type Pointer,
} from './changes.js';
import { newQuestion, resizeOptions, retype, variantOf, type QuestionType } from './fields.js';
import { parsePath, writableRule, type ParsedPath, type Writable } from './graph/paths.js';
import type { Json, Op } from './graph/schema.js';
import { fingerprint, stableFieldId, uniqueKey } from './ids.js';
import { MachineError, type BuilderState, type FieldProvenance } from './state.js';

/**
 * From a patch as the graph declares it to the changes the log stores — `BUILDER-GRAPH.md`,
 * "Patches". Each operation is resolved against the state the operations before it produced, so
 * `set focus = $lastAddedId` after an `add` sees the question the `add` just made.
 *
 * What resolving means, operation by operation:
 * - `[focus]` becomes `[id=<the focused question>]`, so the change means the same question
 *   whatever the focus is later.
 * - `{ $answer: true }` becomes the answer; on a text path (`WRITABLE`'s `localised`), the answer
 *   in the author's language, `{ 'sv-SE': 'Namn' }`.
 * - `{ $newField }` becomes a whole question, with a fingerprint id and a unique key; the sidecar
 *   records where it came from and retires its id (`ids.ts`).
 * - `{ $options: n }` resizes the question's options, keeping the ones it has (`fields.ts`).
 * - `{ $unset: true }` becomes an `unset`.
 * - A new `type` becomes the whole question rebuilt as that type (`fields.ts`, `retype`).
 */

export interface PatchContext {
  /** The node answered, or the cursor for a hand edit: recorded as a new question's origin. */
  readonly nodeId: string;
  readonly source: FieldProvenance['source'];
  /** The quantity or text just given, for `$answer`. */
  readonly answer?: number | string;
  /** The author's language, which a typed answer is written in. */
  readonly locale: string;
}

type Option = z.infer<typeof SelectOption>;

/** The `WRITABLE` pattern of a question. */
const QUESTION = 'draft.definition.fields[*]';

/** `{ $unset: true }`, after resolution: the property is removed. */
const UNSET = Symbol('unset');

/**
 * A value this file built, as the `Json` a change carries. Questions and provenance records are
 * plain data by construction (no functions, no classes, no `undefined` values); their TypeScript
 * interfaces just do not say so.
 */
const asJson = (value: object): Json => value as unknown as Json;

const isRef = (value: Json, name: string): value is { readonly [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && name in value;

/** The path as a pointer, `[focus]` pinned to the focused question. */
function pointerOf(path: ParsedPath, state: BuilderState): Pointer {
  const at: (string | { id: string } | { value: string })[] = [path.root];
  for (const step of path.steps) {
    if (step.kind === 'key') at.push(step.key);
    else if (step.by === 'focus') {
      if (state.focus === null) throw new MachineError('no-focus', 'No question is in focus');
      at.push({ id: state.focus });
    } else at.push(step.by === 'id' ? { id: step.value } : { value: step.value });
  }
  return at;
}

function answerOf(context: PatchContext, rule: Writable): Json {
  if (context.answer === undefined) {
    throw new MachineError('wrong-answer', 'This patch needs an answer and was given none');
  }
  if (rule.localised) {
    if (typeof context.answer !== 'string') {
      throw new MachineError('wrong-answer', 'Text was expected');
    }
    return { [context.locale]: context.answer };
  }
  return context.answer;
}

/** A value with its references replaced: `$answer`, `$lastAddedId`, `$options`. */
function resolveValue(
  value: Json,
  at: Pointer,
  rule: Writable,
  state: BuilderState,
  context: PatchContext,
  lastAddedId: string | null,
): Json {
  if (isRef(value, '$answer')) return answerOf(context, rule);
  if (isRef(value, '$lastAddedId')) {
    if (lastAddedId === null) {
      throw new MachineError('not-found', '$lastAddedId, but nothing was added before it');
    }
    return lastAddedId;
  }
  if (isRef(value, '$options')) {
    const wanted = value['$options'];
    const count =
      wanted !== undefined && isRef(wanted, '$answer') ? answerOf(context, rule) : wanted;
    if (typeof count !== 'number') throw new MachineError('wrong-answer', 'A count was expected');
    return asJson(resizeOptions(get(state, at) as Option[] | undefined, count));
  }
  return value;
}

/** The last element of the list at `at`, as a selector: where an `add` appends after. */
function lastOf(state: BuilderState, at: Pointer) {
  const list = get(state, at);
  if (!Array.isArray(list)) throw new MachineError('not-found', `${at.join('.')}: not a list`);
  return list.length === 0 ? null : identityOf(list[list.length - 1]);
}

/** The element of the list at `at` whose id or value is `key`, as a selector. */
function selectorIn(state: BuilderState, at: Pointer, key: string) {
  const list = get(state, at);
  const element = Array.isArray(list)
    ? list.find((item) => {
        const identity = identityOf(item);
        return identity !== null && ('id' in identity ? identity.id : identity.value) === key;
      })
    : undefined;
  const identity = identityOf(element);
  if (!identity) throw new MachineError('not-found', `${at.join('.')}: no element ${key}`);
  return identity;
}

/** Every question id in the form, including the ones inside repeating blocks. */
function fieldIds(state: BuilderState): string[] {
  return state.draft.definition.fields.flatMap((field) =>
    field.type === 'repeating_group' ? [field.id, ...field.fields.map((f) => f.id)] : [field.id],
  );
}

/** `$newField`: the question, and the sidecar entries that record it. */
function newFieldChanges(
  spec: { readonly [key: string]: Json },
  state: BuilderState,
  context: PatchContext,
): { changes: Change[]; id: string } {
  const type = spec['type'] as QuestionType;
  const word = typeof spec['word'] === 'string' ? (spec['word'] as keyof typeof V) : null;
  const wantedKey = typeof spec['key'] === 'string' ? spec['key'] : type;
  const fields = state.draft.definition.fields;

  const section = fields.findLast((field) => field.type === 'section_break');
  const print = fingerprint(
    (spec['key'] as string | undefined) ?? word ?? type,
    fields.length + 1,
    section?.id ?? '',
  );
  const id = stableFieldId(print, new Set([...fieldIds(state), ...state.sidecar.retiredIds]));
  const question = newQuestion({
    id,
    key: uniqueKey(wantedKey, new Set(fields.map((field) => field.key))),
    type,
    label: word ? { ...V[word] } : {},
    required: spec['required'] === true,
  });

  const list: Pointer = ['draft', 'definition', 'fields'];
  const provenance: FieldProvenance = { source: context.source, nodeId: context.nodeId };
  return {
    id,
    changes: [
      { op: 'insert', at: list, value: asJson(question), after: lastOf(state, list) },
      { op: 'set', at: ['sidecar', 'fields', id], value: asJson(provenance) },
      { op: 'set', at: ['sidecar', 'retiredIds'], value: [...state.sidecar.retiredIds, id] },
    ],
  };
}

/** `['draft', 'definition', 'fields', { id }]`: the part of a pointer that names a question. */
const FIELD_DEPTH = 4;

function questionAt(state: BuilderState, at: Pointer): { field: Field; fieldAt: Pointer } {
  const fieldAt = at.slice(0, FIELD_DEPTH);
  const field = get(state, fieldAt) as Field | undefined;
  if (!field) throw new MachineError('not-found', 'No such question');
  return { field, fieldAt };
}

/**
 * A write to one property of a question, stored as that whole property rebuilt by the schema — so
 * `style.shape = 'pill'` on a question with no style yet stores the style a save and a load would
 * give back (`{ shape: 'pill', size: 'regular', … }`), and a property the question's type has no
 * place for (`appearance` on typed text) is refused rather than silently dropped.
 */
function questionChanges(at: Pointer, value: Json | typeof UNSET, state: BuilderState): Change[] {
  const { field, fieldAt } = questionAt(state, at);
  const [property, ...inner] = at.slice(FIELD_DEPTH);
  if (typeof property !== 'string') throw new MachineError('not-found', 'No property named');
  const schema = (variantOf(field.type).shape as Record<string, z.ZodTypeAny>)[property];
  if (!schema) {
    throw new MachineError('invalid-draft', `A ${field.type} question has no ${property}`);
  }
  const current = get(field, [property]);
  const updated =
    inner.length === 0
      ? value === UNSET
        ? undefined
        : value
      : applyChange(
          current ?? {},
          value === UNSET ? { op: 'unset', at: inner } : { op: 'set', at: inner, value },
        );
  const parsed = schema.safeParse(updated);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MachineError('invalid-draft', `${property}: ${issue?.message ?? 'refused'}`);
  }
  const propertyAt = [...fieldAt, property];
  return parsed.data === undefined
    ? [{ op: 'unset', at: propertyAt }]
    : [{ op: 'set', at: propertyAt, value: parsed.data as Json }];
}

/** A new `type`: the whole question rebuilt, and whatever it could not keep set aside. */
function retypeChanges(at: Pointer, type: QuestionType, state: BuilderState): Change[] {
  const { field, fieldAt } = questionAt(state, at);
  // Already that type: nothing to rebuild, and nothing for the log to carry.
  if (field.type === type) return [];
  const provenance = state.sidecar.fields[field.id];
  const rebuilt = retype(field, type, provenance?.setAside ?? {});
  const changes: Change[] = [{ op: 'set', at: fieldAt, value: asJson(rebuilt.field) }];

  if (!jsonEqual(provenance?.setAside ?? {}, rebuilt.setAside)) {
    const { setAside: _previous, ...rest } = provenance ?? { source: 'manual' as const };
    const next: FieldProvenance =
      Object.keys(rebuilt.setAside).length > 0 ? { ...rest, setAside: rebuilt.setAside } : rest;
    changes.push({ op: 'set', at: ['sidecar', 'fields', field.id], value: asJson(next) });
  }
  return changes;
}

/** One declared operation, resolved against `state`. */
function resolveOp(
  op: Op,
  state: BuilderState,
  context: PatchContext,
  lastAddedId: string | null,
): { changes: Change[]; added: string | null } {
  const path = parsePath(op.path);
  const rule = path ? writableRule(op, path) : null;
  if (!path || !rule) throw new MachineError('not-writable', `${op.op} on "${op.path}"`);
  const at = pointerOf(path, state);

  switch (op.op) {
    case 'set': {
      const unset = isRef(op.value, '$unset');
      if (!rule.pattern.startsWith(QUESTION)) {
        if (unset) return { changes: [{ op: 'unset', at }], added: null };
        const value = resolveValue(op.value, at, rule, state, context, lastAddedId);
        return { changes: [{ op: 'set', at, value }], added: null };
      }
      if (rule.pattern === `${QUESTION}.type`) {
        return { changes: retypeChanges(at, op.value as QuestionType, state), added: null };
      }
      const value = unset ? UNSET : resolveValue(op.value, at, rule, state, context, lastAddedId);
      return { changes: questionChanges(at, value, state), added: null };
    }
    case 'add': {
      if (isRef(op.value, '$newField')) {
        const made = newFieldChanges(
          op.value['$newField'] as { readonly [key: string]: Json },
          state,
          context,
        );
        return { changes: made.changes, added: made.id };
      }
      const value = resolveValue(op.value, at, rule, state, context, lastAddedId);
      return { changes: [{ op: 'insert', at, value, after: lastOf(state, at) }], added: null };
    }
    case 'remove':
      return { changes: [{ op: 'remove', at }], added: null };
    case 'insert': {
      const value = resolveValue(op.value, at, rule, state, context, lastAddedId);
      const after = op.after === null ? null : selectorIn(state, at, op.after);
      return { changes: [{ op: 'insert', at, value, after }], added: null };
    }
    case 'reorder': {
      const after = op.after === null ? null : selectorIn(state, at, op.after);
      return {
        changes: [{ op: 'reorder', at: [...at, selectorIn(state, at, op.id)], after }],
        added: null,
      };
    }
  }
}

/**
 * A declared patch, resolved and applied: the state after it, the changes to store, and the
 * inverse that undoes them (last change first).
 */
export function runPatch(
  state: BuilderState,
  ops: readonly Op[],
  context: PatchContext,
): { state: BuilderState; changes: Change[]; inverse: Change[] } {
  let here = state;
  let lastAddedId: string | null = null;
  const changes: Change[] = [];
  const inverse: Change[] = [];
  for (const op of ops) {
    const resolved = resolveOp(op, here, context, lastAddedId);
    for (const change of resolved.changes) {
      const undo = inverseOf(here, change);
      here = applyChange(here, change);
      changes.push(change);
      if (undo) inverse.unshift(undo);
    }
    lastAddedId = resolved.added ?? lastAddedId;
  }
  return { state: here, changes, inverse };
}
