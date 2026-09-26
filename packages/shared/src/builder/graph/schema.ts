import { z } from 'zod';

/**
 * The guided builder's conversation, as data — the types, and a runtime schema for the same shape.
 *
 * `docs/plan/BUILDER-GRAPH.md` is the specification and ADR 0020 the decision. The short version:
 * components render nodes and never decide which node comes next, so the whole conversation can be
 * validated for dead ends, walked by a test, and replayed from a log. None of that is possible if
 * the order of questions lives in an `if` inside a component.
 *
 * ## Why both a type and a Zod schema
 *
 * The shipped graph is typed TypeScript data (`nodes.ts`, `satisfies BuilderGraph`), so the
 * compiler catches a misspelt kind the moment it is typed. The schema is for everything the
 * compiler cannot see: a graph built in a test to be broken on purpose, and — if the graph is ever
 * delivered as JSON — a graph read from the wire. `validate.ts` reports a schema failure as rule G0
 * and checks nothing else, because every later rule assumes the shape.
 *
 * Everything here is pure: no DOM, no I/O, no clock (`CLAUDE.md`, "Guided Builder & Import").
 */

/** A message key in `apps/forms/src/lib/messages` — never a literal string. */
export type MessageKey = `guided.${string}`;

/** A `when` expression — see `guards.ts`. */
export type Guard = string;

/** Log-odds contribution in millinats (1/1000 of a natural-log unit). Always an integer. */
export type Millinats = number;

/** A path into the builder's state — see `paths.ts`. */
export type Path = string;

export const NODE_KINDS = [
  'question',
  'quantity',
  'pick-one',
  'pick-many',
  'text-entry',
  'confirm-guess',
  'preview-moment',
  'review-queue',
  'menu',
  'end',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Where to go next: one node, or guarded branches read top to bottom ending in `when: 'true'`. */
export type Next = string | readonly { readonly when: Guard; readonly to: string }[];

/**
 * Why a node was skipped, as the trail says it: one sentence, or — for a node with more than one
 * reason not to be asked — the first whose guard holds, read top to bottom, ending in
 * `when: 'true'`. One sentence for two reasons is how "Already read from your document" came to be
 * shown for a question skipped because the person said no to buttons.
 */
export type Skip = MessageKey | readonly { readonly when: Guard; readonly skip: MessageKey }[];

/**
 * A value in a patch. Plain JSON, or one of the references the machine resolves when the patch is
 * applied (and stores resolved in the log, so replay never re-resolves):
 *
 * - `{ $answer: true }` — the quantity or text just given.
 * - `{ $newField: { type, word?, key?, required? } }` — a new field; `word` names its label in
 *   `forms/vocabulary.ts`, which already carries it in all twelve languages.
 * - `{ $options: n | { $answer: true } }` — n placeholder options.
 * - `{ $lastAddedId: true }` — the id of the field the previous `add` created.
 * - `{ $unset: true }` — with `set`, removes the key.
 */
export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type Op =
  | { readonly op: 'set'; readonly path: Path; readonly value: Json }
  | { readonly op: 'add'; readonly path: Path; readonly value: Json }
  | { readonly op: 'remove'; readonly path: Path }
  | {
      readonly op: 'insert';
      readonly path: Path;
      readonly value: Json;
      readonly after: string | null;
    }
  | {
      readonly op: 'reorder';
      readonly path: Path;
      readonly id: string;
      readonly after: string | null;
    };

export interface Option {
  readonly id: string;
  /** Labelled by consequence: "One answer only", not "Single select". */
  readonly label: MessageKey;
  readonly detail?: MessageKey;
  /** An `Icon.tsx` name. */
  readonly icon?: string;
  readonly patch: readonly Op[];
  /** Template id → millinats, added to the belief when this option is chosen. */
  readonly score?: { readonly [templateId: string]: Millinats };
  /** Overrides the node's `next` for this answer. */
  readonly next?: Next;
}

interface Base {
  /** Dotted, group first: `choice.buttons`. */
  readonly id: string;
  /** The feature this node belongs to — what `menu.siblings(<group>)` lists. */
  readonly group: string;
  /** The question, at most nine words in English. */
  readonly ask: MessageKey;
  /** One line, for the "?" affordance. */
  readonly help: MessageKey;
  /** Absent means always asked. */
  readonly when?: Guard;
  /** Required with `when`: why the node was skipped, in plain words. */
  readonly skip?: Skip;
  readonly next: Next;
  /** A `menu` node id, or `menu.siblings(<group>)`. */
  readonly escape: string;
  /** A preview spec id: what to render after this node. */
  readonly preview?: string;
  /** The option a negated phrase selects ("no buttons") — `docs/plan/INTENT-LADDER.md`. */
  readonly negative?: string;
}

export type QuestionNode = Base & {
  readonly kind: 'question';
  readonly options: readonly Option[];
};
export type PickOneNode = Base & { readonly kind: 'pick-one'; readonly options: readonly Option[] };
export type PickManyNode = Base & {
  readonly kind: 'pick-many';
  readonly options: readonly Option[];
};
export type QuantityNode = Base & {
  readonly kind: 'quantity';
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly patch: readonly Op[];
};
export type TextEntryNode = Base & {
  readonly kind: 'text-entry';
  /** Example chips. Labels only — never operative wording (ADR 0012, rule G13). */
  readonly examples: readonly MessageKey[];
  readonly required: boolean;
  readonly patch: readonly Op[];
};
export type ConfirmGuessNode = Base & { readonly kind: 'confirm-guess' };
export type PreviewMomentNode = Base & {
  readonly kind: 'preview-moment';
  readonly preview: string;
};
export type ReviewQueueNode = Base & { readonly kind: 'review-queue' };
export type MenuNode = Base & { readonly kind: 'menu'; readonly entries: readonly string[] };
/** The end has nowhere to go and nothing to escape to: publishing, or "keep going", is the UI's. */
export type EndNode = Omit<Base, 'next' | 'escape'> & { readonly kind: 'end' };

export type Node =
  | QuestionNode
  | PickOneNode
  | PickManyNode
  | QuantityNode
  | TextEntryNode
  | ConfirmGuessNode
  | PreviewMomentNode
  | ReviewQueueNode
  | MenuNode
  | EndNode;

export interface BuilderGraph {
  /** Bumped when the graph changes. Logs store resolved patches, so old sessions still replay. */
  readonly graphVersion: number;
  readonly start: string;
  /**
   * Paths the shell sets before the conversation starts — the only facts that come from outside,
   * and they arrive as data in state, never as a call from inside a guard.
   */
  readonly inputs: readonly Path[];
  readonly nodes: readonly Node[];
}

/** Message keys a node kind renders by itself, beyond the node's own. */
export const KIND_KEYS: Readonly<Record<NodeKind, readonly MessageKey[]>> = {
  question: [],
  quantity: [],
  'pick-one': [],
  'pick-many': [],
  'text-entry': [],
  'confirm-guess': ['guided.guess.right', 'guided.guess.sortOf', 'guided.guess.no'],
  'preview-moment': [],
  'review-queue': [],
  menu: [],
  end: [],
};

const key = z.string().regex(/^guided\.[a-zA-Z0-9.]+$/);
const id = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9-]*)*$/);
const next = z.union([id, z.array(z.object({ when: z.string().min(1), to: id }).strict()).min(1)]);
const skip = z.union([
  key,
  z.array(z.object({ when: z.string().min(1), skip: key }).strict()).min(1),
]);
/** Plain JSON, as a schema: for patches here, and for the session the machine saves. */
export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonSchema),
    z.record(JsonSchema),
  ]),
);
const json = JsonSchema;
const op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: z.string(), value: json }).strict(),
  z.object({ op: z.literal('add'), path: z.string(), value: json }).strict(),
  z.object({ op: z.literal('remove'), path: z.string() }).strict(),
  z
    .object({
      op: z.literal('insert'),
      path: z.string(),
      value: json,
      after: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('reorder'),
      path: z.string(),
      id: z.string(),
      after: z.string().nullable(),
    })
    .strict(),
]);
const option = z
  .object({
    id: z.string().regex(/^[a-z][a-zA-Z0-9-]*$/),
    label: key,
    detail: key.optional(),
    icon: z.string().optional(),
    patch: z.array(op),
    score: z.record(z.number()).optional(),
    next: next.optional(),
  })
  .strict();
const base = {
  id,
  group: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  ask: key,
  help: key,
  when: z.string().optional(),
  skip: skip.optional(),
  next,
  escape: z.string(),
  preview: z.string().optional(),
  negative: z.string().optional(),
};
const withOptions = { ...base, options: z.array(option) };

export const BuilderGraphSchema = z
  .object({
    graphVersion: z.number().int().positive(),
    start: id,
    inputs: z.array(z.string()),
    nodes: z.array(
      z.discriminatedUnion('kind', [
        z.object({ ...withOptions, kind: z.literal('question') }).strict(),
        z.object({ ...withOptions, kind: z.literal('pick-one') }).strict(),
        z.object({ ...withOptions, kind: z.literal('pick-many') }).strict(),
        z
          .object({
            ...base,
            kind: z.literal('quantity'),
            min: z.number().int(),
            max: z.number().int(),
            default: z.number().int(),
            patch: z.array(op),
          })
          .strict(),
        z
          .object({
            ...base,
            kind: z.literal('text-entry'),
            examples: z.array(key),
            required: z.boolean(),
            patch: z.array(op),
          })
          .strict(),
        z.object({ ...base, kind: z.literal('confirm-guess') }).strict(),
        z.object({ ...base, kind: z.literal('preview-moment'), preview: z.string() }).strict(),
        z.object({ ...base, kind: z.literal('review-queue') }).strict(),
        z.object({ ...base, kind: z.literal('menu'), entries: z.array(id) }).strict(),
        z
          .object({
            id,
            group: base.group,
            ask: key,
            help: key,
            when: base.when,
            skip: base.skip,
            preview: base.preview,
            negative: base.negative,
            kind: z.literal('end'),
          })
          .strict(),
      ]),
    ),
  })
  .strict();

/** The options a node offers, or none for kinds without them. */
export function optionsOf(node: Node): readonly Option[] {
  return 'options' in node ? node.options : [];
}

/** Every patch a node can apply: its own and each option's. */
export function patchesOf(node: Node): readonly (readonly Op[])[] {
  const own = 'patch' in node ? [node.patch] : [];
  return [...own, ...optionsOf(node).map((option) => option.patch)];
}
