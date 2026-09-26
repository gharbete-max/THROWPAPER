import { z } from 'zod';
import {
  CHOICE_ACCENTS,
  CHOICE_COLUMNS,
  CHOICE_SHAPES,
  CHOICE_SIZES,
  FieldWidth,
  MULTI_SELECT_APPEARANCES,
  RATING_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  SelectOption,
  YES_NO_APPEARANCES,
} from '../../forms/definition.js';
import { V } from '../../forms/vocabulary.js';
import { LocalisedText } from '../../api/common.js';
import { QUESTION_TYPES } from '../fields.js';
import type { Json, Op } from './schema.js';

/**
 * Paths into the builder's state, without array indices.
 *
 * A path written today has to mean the same field after the person reorders their questions, so
 * fields and options are addressed by what they are — `[focus]`, `[id=…]`, `[value=…]` — never by
 * where they are. The grammar (`docs/plan/BUILDER-GRAPH.md`, "State and paths"):
 *
 *     path     = root ( '.' key | '[' selector ']' )*
 *     root     = draft | sidecar | pending | focus | guess
 *     key      = [a-zA-Z][a-zA-Z0-9]*
 *     selector = focus | id=<id> | value=<value>
 *
 * Reading is **total**: a path that does not resolve is `undefined`, never an exception, which is
 * what lets a guard be evaluated against any state at all. Writing is the opposite — only the paths
 * in `WRITABLE` may be patched, each with the values it accepts, and `builder:validate` holds every
 * patch in the graph to that list (rule G5).
 */

export const PATH_ROOTS = ['draft', 'sidecar', 'pending', 'focus', 'guess'] as const;
export type PathRoot = (typeof PATH_ROOTS)[number];

export type Step =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'select'; readonly by: 'focus' }
  | { readonly kind: 'select'; readonly by: 'id' | 'value'; readonly value: string };

export interface ParsedPath {
  readonly root: PathRoot;
  readonly steps: readonly Step[];
}

const KEY = /^[a-zA-Z][a-zA-Z0-9]*/;
const SELECT_VALUE = /^[A-Za-z0-9_.-]+$/;

/** Parses a path, or returns null. Never throws: a guard with a bad path is a validation finding. */
export function parsePath(text: string): ParsedPath | null {
  const head = KEY.exec(text);
  if (!head || !(PATH_ROOTS as readonly string[]).includes(head[0])) return null;
  const root = head[0] as PathRoot;
  const steps: Step[] = [];
  let rest = text.slice(head[0].length);
  while (rest.length > 0) {
    if (rest.startsWith('.')) {
      const key = KEY.exec(rest.slice(1));
      if (!key) return null;
      steps.push({ kind: 'key', key: key[0] });
      rest = rest.slice(1 + key[0].length);
    } else if (rest.startsWith('[')) {
      const close = rest.indexOf(']');
      if (close < 0) return null;
      const inner = rest.slice(1, close);
      if (inner === 'focus') steps.push({ kind: 'select', by: 'focus' });
      else {
        const match = /^(id|value)=(.+)$/.exec(inner);
        if (!match || !SELECT_VALUE.test(match[2]!)) return null;
        steps.push({ kind: 'select', by: match[1] as 'id' | 'value', value: match[2]! });
      }
      rest = rest.slice(close + 1);
    } else return null;
  }
  return { root, steps };
}

/** The shape of a path with its selectors blanked: `draft.definition.fields[*].style.shape`. */
export function pattern(path: ParsedPath): string {
  let out: string = path.root;
  for (const step of path.steps) out += step.kind === 'key' ? `.${step.key}` : '[*]';
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a path holds in `state`, or `undefined`. Total.
 *
 * `state` is any plain object with the path roots as keys. `[focus]` finds the array element whose
 * `id` is `state.focus`; `[id=x]` and `[value=x]` find the element whose `id` or `value` is `x`.
 * Own properties only, so a key like `constructor` resolves to nothing rather than to a prototype.
 */
export function resolvePath(state: unknown, path: ParsedPath): unknown {
  if (!isRecord(state)) return undefined;
  let here: unknown = Object.hasOwn(state, path.root) ? state[path.root] : undefined;
  for (const step of path.steps) {
    if (step.kind === 'key') {
      here = isRecord(here) && Object.hasOwn(here, step.key) ? here[step.key] : undefined;
      continue;
    }
    if (!Array.isArray(here)) return undefined;
    const wanted = step.by === 'focus' ? state.focus : step.value;
    const field = step.by === 'value' ? 'value' : 'id';
    here = here.find((item: unknown) => isRecord(item) && item[field] === wanted);
  }
  return here;
}

// --- What may be written, and with what -------------------------------------------------------

const answer = z.object({ $answer: z.literal(true) }).strict();
const unset = z.object({ $unset: z.literal(true) }).strict();
const text = z.union([LocalisedText, answer]);
const vocabularyWord = z.enum(Object.keys(V) as [string, ...string[]]);
/** Only types the machine can build from a label alone (`builder/fields.ts`). */
const questionType = z.enum(QUESTION_TYPES);
const newField = z
  .object({
    $newField: z
      .object({
        type: questionType,
        word: vocabularyWord.optional(),
        key: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        required: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
const options = z.union([
  z.array(SelectOption),
  z.object({ $options: z.union([z.number().int().min(2).max(30), answer]) }).strict(),
]);
const appearance = z.enum([
  ...new Set([
    ...SINGLE_SELECT_APPEARANCES,
    ...MULTI_SELECT_APPEARANCES,
    ...YES_NO_APPEARANCES,
    ...RATING_APPEARANCES,
  ]),
] as [string, ...string[]]);

const FIELD = 'draft.definition.fields[*]';

/** One row of `WRITABLE`. */
export interface Writable {
  readonly pattern: string;
  readonly ops: readonly Op['op'][];
  readonly value?: z.ZodType<unknown>;
  /** Text in a language: `{ $answer: true }` becomes `{ <author's locale>: answer }`. */
  readonly localised?: true;
}

/**
 * Every path a patch may write, the operations allowed on it, and the values each accepts.
 *
 * Deliberately a short list. A path is added here in the same change as the node that needs it,
 * which keeps "what can the conversation change" answerable by reading one table.
 *
 * `pending.*` is the conversation's working memory — any key, any JSON — because it is never
 * published and never leaves the session.
 */
export const WRITABLE: readonly Writable[] = [
  { pattern: 'pending.*', ops: ['set'], value: z.unknown() },
  { pattern: 'focus', ops: ['set'], value: z.object({ $lastAddedId: z.literal(true) }).strict() },
  { pattern: 'sidecar.brandDecided', ops: ['set'], value: z.enum(['organisation', 'default']) },
  { pattern: 'draft.title', ops: ['set'], value: text, localised: true },
  { pattern: 'draft.definition.fields', ops: ['add'], value: newField },
  { pattern: 'draft.definition.fields', ops: ['reorder'] },
  { pattern: FIELD, ops: ['remove'] },
  { pattern: `${FIELD}.label`, ops: ['set'], value: text, localised: true },
  { pattern: `${FIELD}.helpText`, ops: ['set'], value: z.union([text, unset]), localised: true },
  { pattern: `${FIELD}.required`, ops: ['set'], value: z.boolean() },
  { pattern: `${FIELD}.width`, ops: ['set'], value: FieldWidth },
  // The machine rebuilds the whole question as the new type (`builder/fields.ts`, `retype`).
  { pattern: `${FIELD}.type`, ops: ['set'], value: questionType },
  { pattern: `${FIELD}.appearance`, ops: ['set'], value: appearance },
  { pattern: `${FIELD}.options`, ops: ['set'], value: options },
  { pattern: `${FIELD}.style.shape`, ops: ['set'], value: z.enum(CHOICE_SHAPES) },
  { pattern: `${FIELD}.style.size`, ops: ['set'], value: z.enum(CHOICE_SIZES) },
  { pattern: `${FIELD}.style.accent`, ops: ['set'], value: z.enum(CHOICE_ACCENTS) },
  { pattern: `${FIELD}.style.columns`, ops: ['set'], value: z.enum(CHOICE_COLUMNS) },
];

/** The row of `WRITABLE` that allows this operation on this path, or null. */
export function writableRule(op: Op, parsed: ParsedPath): Writable | null {
  const shape = pattern(parsed);
  return (
    WRITABLE.find(
      (entry) =>
        entry.ops.includes(op.op) &&
        (entry.pattern === shape ||
          (entry.pattern === 'pending.*' &&
            parsed.root === 'pending' &&
            parsed.steps.length === 1)),
    ) ?? null
  );
}

/** Why an operation is not allowed, or null when it is. */
export function opProblem(op: Op): string | null {
  const parsed = parsePath(op.path);
  if (!parsed) return `"${op.path}" is not a path`;
  const rule = writableRule(op, parsed);
  if (!rule) return `${op.op} is not allowed on "${op.path}"`;
  if ('value' in op && rule.value && !rule.value.safeParse(op.value as Json).success) {
    return `${JSON.stringify(op.value)} is not a value "${op.path}" accepts`;
  }
  return null;
}
