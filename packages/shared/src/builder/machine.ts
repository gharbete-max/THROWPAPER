import { LocalisedText, Locale } from '../api/common.js';
import { FormDefinition } from '../forms/definition.js';
import { applyAll, jsonEqual, type Change } from './changes.js';
import { evaluateGuard, parseGuard, type GuardState } from './graph/guards.js';
import { opProblem } from './graph/paths.js';
import type { BuilderGraph, Json, MessageKey, Next, Node, Op } from './graph/schema.js';
import { runPatch } from './patches.js';
import {
  MachineError,
  type BuilderDraft,
  type BuilderSidecar,
  type BuilderState,
  type FieldProvenance,
  type Guess,
} from './state.js';

/**
 * The machine: the pure reducer that walks the conversation — `PREDICTIVE-BUILDER.md`, "The
 * conversation"; `BUILDER-GRAPH.md`; ADR 0020.
 *
 * A conversation is where it started (`base`) and every step since (`log`); its `state` is always
 * exactly `replay(base, log)`, which the tests hold it to. Each step stores the resolved changes
 * and their inverse, never just "node X, option Y", so:
 *
 * - **Back** applies the last inverse; **a breadcrumb** replays the log up to it; the two agree.
 * - **Replay** needs no graph: a session saved under one graph version replays identically
 *   after the graph has changed what an option does.
 * - **Every state is a form the schema accepts.** A step that would leave the draft otherwise is
 *   refused, and nothing changes; `machine.test.ts` walks the graph to show the shipped one never
 *   does, and that a publishable draft stays publishable.
 *
 * Functions return new values or throw a `MachineError`; they never mutate what they are given.
 */

/** How free text was read (`INTENT-LADDER.md`, tiers T0–T8), or null for a direct pick. */
export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';

export type Answer =
  /** A `question` or `pick-one` option. */
  | { readonly kind: 'option'; readonly optionId: string }
  /** The options picked on a `pick-many`, applied in the order the node declares them. */
  | { readonly kind: 'options'; readonly optionIds: readonly string[] }
  | { readonly kind: 'quantity'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  /** Right / Sort of / No on a `confirm-guess`. What each seeds is S11's; here it moves on. */
  | { readonly kind: 'guess'; readonly verdict: 'right' | 'sort-of' | 'no' }
  /** On past a `preview-moment` or a `review-queue`. */
  | { readonly kind: 'continue' }
  /** Out through the escape — a menu, a sibling — or a menu's pick. */
  | { readonly kind: 'jump'; readonly to: string }
  /** A hand edit (`source: 'manual'`): inline editing on the preview. */
  | { readonly kind: 'edit' };

/** A node passed over because its `when` was false, and the sentence that says why. */
export interface Skipped {
  readonly nodeId: string;
  readonly reason: MessageKey;
}

export interface LogEntry {
  /** The node answered — or the cursor, for a jump or a hand edit. */
  readonly nodeId: string;
  readonly answer: Answer;
  readonly patch: readonly Change[];
  /** Undoes `patch`, in the order to apply it. */
  readonly inverse: readonly Change[];
  /** Where the conversation went next. */
  readonly to: string;
  /** Nodes passed over on the way there, for the trail — greyed, with their reason. */
  readonly skipped: readonly Skipped[];
  readonly tier: Tier | null;
  readonly source: FieldProvenance['source'];
}

export interface Conversation {
  readonly base: BuilderState;
  readonly log: readonly LogEntry[];
  /** Always `replay(base, log)`. */
  readonly state: BuilderState;
}

export interface AnswerContext {
  /** The author's language: a typed answer is text in it. */
  readonly locale: string;
  /** How a free-text answer was read; absent for a click or a key. */
  readonly tier?: Tier | null;
}

// --- Reading the graph ------------------------------------------------------------------------

function nodeOf(graph: BuilderGraph, id: string): Node {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new MachineError('no-node', `There is no node "${id}"`);
  return node;
}

/** The node the conversation is at. */
export function currentNode(graph: BuilderGraph, conversation: Conversation): Node {
  return nodeOf(graph, conversation.state.cursor);
}

/** The nodes that have an answer in the log — what `answered()` reads. */
function answeredIds(log: readonly LogEntry[]): string[] {
  return log
    .filter((entry) => entry.answer.kind !== 'jump' && entry.answer.kind !== 'edit')
    .map((entry) => entry.nodeId);
}

function guardState(state: BuilderState, answered: readonly string[]): GuardState {
  const { draft, sidecar, pending, focus, guess } = state;
  return { draft, sidecar, pending, focus, guess, answered };
}

const holds = (guard: string, state: GuardState) => evaluateGuard(parseGuard(guard), state);

/** The first branch of `next` whose guard holds. */
function pickNext(next: Next, state: GuardState): string {
  if (typeof next === 'string') return next;
  const branch = next.find((candidate) => holds(candidate.when, state));
  if (!branch) throw new MachineError('no-node', 'No branch of `next` holds');
  return branch.to;
}

/** The sentence for a skipped node: its one reason, or the first of its reasons that holds. */
function reasonFor(node: Node, state: GuardState): MessageKey {
  const { skip } = node;
  if (skip === undefined) throw new MachineError('no-node', `${node.id} is skipped with no reason`);
  if (typeof skip === 'string') return skip;
  const reason = skip.find((candidate) => holds(candidate.when, state));
  if (!reason) throw new MachineError('no-node', `${node.id}: no skip reason holds`);
  return reason.skip;
}

/**
 * From `target`, past every node whose `when` is false, to the node to ask. Bounded by the size of
 * the graph: rule G6 refuses a cycle of unconditional edges, and this refuses to go round anyway.
 */
function settle(
  graph: BuilderGraph,
  state: BuilderState,
  answered: readonly string[],
  target: string,
): { to: string; skipped: Skipped[] } {
  const guards = guardState(state, answered);
  const skipped: Skipped[] = [];
  let id = target;
  for (let hops = 0; hops <= graph.nodes.length; hops += 1) {
    const node = nodeOf(graph, id);
    if (node.when === undefined || holds(node.when, guards)) return { to: id, skipped };
    if (node.kind === 'end') break;
    skipped.push({ nodeId: id, reason: reasonFor(node, guards) });
    id = pickNext(node.next, guards);
  }
  throw new MachineError('no-node', `Nothing to ask after skipping from "${target}"`);
}

/**
 * Where a jump from this node may go: its escape — a menu node, or every node of a group for
 * `menu.siblings(<group>)` — and, from a menu, its entries. The end escapes to the menus.
 */
export function jumpTargets(graph: BuilderGraph, nodeId: string): string[] {
  const node = nodeOf(graph, nodeId);
  const targets: string[] = [];
  if (node.kind === 'menu') targets.push(...node.entries);
  if (node.kind === 'end') {
    targets.push(...graph.nodes.filter((n) => n.kind === 'menu').map((n) => n.id));
  } else {
    const siblings = /^menu\.siblings\(([a-zA-Z0-9]+)\)$/.exec(node.escape);
    if (siblings)
      targets.push(...graph.nodes.filter((n) => n.group === siblings[1]).map((n) => n.id));
    else targets.push(node.escape);
  }
  return [...new Set(targets)];
}

// --- The draft is always a form ----------------------------------------------------------------

/**
 * The draft as the schema would store it, or an error. Exactly: a value the schema would drop or
 * fill in is refused too, so what the machine holds is what a save and a load give back.
 */
function checkDraft(draft: BuilderDraft): void {
  const definition = FormDefinition.safeParse(draft.definition);
  const title = LocalisedText.safeParse(draft.title);
  const issue = !definition.success
    ? definition.error.issues[0]
    : !title.success
      ? title.error.issues[0]
      : undefined;
  if (issue) {
    throw new MachineError('invalid-draft', `${issue.path.join('.')}: ${issue.message}`);
  }
  if (!jsonEqual(definition.data, draft.definition)) {
    throw new MachineError(
      'invalid-draft',
      'The draft holds something the form schema would change',
    );
  }
}

// --- Beginning --------------------------------------------------------------------------------

export interface BeginInput {
  readonly definition: FormDefinition;
  readonly title: BuilderDraft['title'];
  /** Carried from an earlier session or an import; a fresh one otherwise. */
  readonly sidecar?: BuilderSidecar;
  /** The facts the shell provides first — the graph's `inputs`, e.g. `brandKitExists`. */
  readonly pending?: { readonly [key: string]: Json };
  readonly guess?: Guess | null;
}

/**
 * A conversation about a form, at the first node that applies. The ids the form already has are
 * retired from the start: an existing question's id is never given to a new one.
 */
export function begin(graph: BuilderGraph, input: BeginInput): Conversation {
  const ids = input.definition.fields.flatMap((field) =>
    field.type === 'repeating_group' ? [field.id, ...field.fields.map((f) => f.id)] : [field.id],
  );
  const draft: BuilderDraft = { definition: input.definition, title: input.title };
  checkDraft(draft);
  const unsettled: BuilderState = {
    draft,
    sidecar: input.sidecar ?? { provenance: 'guided', fields: {}, retiredIds: ids },
    pending: input.pending ?? {},
    focus: null,
    guess: input.guess ?? null,
    cursor: graph.start,
  };
  const base = { ...unsettled, cursor: settle(graph, unsettled, [], graph.start).to };
  return { base, log: [], state: base };
}

// --- Answering --------------------------------------------------------------------------------

/** The patch an answer applies and where it points next, after checking it fits the node. */
function planFor(
  graph: BuilderGraph,
  node: Node,
  answer: Answer,
): { ops: readonly Op[]; next: Next; value?: number | string } {
  const wrong = (why: string) => new MachineError('wrong-answer', `${node.id}: ${why}`);

  if (answer.kind === 'jump') {
    if (!jumpTargets(graph, node.id).includes(answer.to))
      throw wrong(`cannot jump to ${answer.to}`);
    return { ops: [], next: answer.to };
  }
  switch (node.kind) {
    case 'question':
    case 'pick-one': {
      if (answer.kind !== 'option') throw wrong('an option was expected');
      const option = node.options.find((candidate) => candidate.id === answer.optionId);
      if (!option) throw wrong(`no option "${answer.optionId}"`);
      return { ops: option.patch, next: option.next ?? node.next };
    }
    case 'pick-many': {
      if (answer.kind !== 'options') throw wrong('a set of options was expected');
      const picked = new Set(answer.optionIds);
      if (picked.size !== answer.optionIds.length) throw wrong('an option was picked twice');
      for (const id of picked) {
        if (!node.options.some((option) => option.id === id)) throw wrong(`no option "${id}"`);
      }
      const ops = node.options.filter((option) => picked.has(option.id)).flatMap((o) => o.patch);
      return { ops, next: node.next };
    }
    case 'quantity': {
      if (answer.kind !== 'quantity') throw wrong('a number was expected');
      const { value } = answer;
      if (!Number.isSafeInteger(value) || value < node.min || value > node.max) {
        throw new MachineError(
          'out-of-range',
          `${node.id}: ${value} is not ${node.min}–${node.max}`,
        );
      }
      return { ops: node.patch, next: node.next, value };
    }
    case 'text-entry': {
      if (answer.kind !== 'text') throw wrong('text was expected');
      // Trimmed, and verbatim otherwise: never corrected, never re-cased.
      const value = answer.value.trim();
      if (value === '') {
        if (node.required)
          throw new MachineError('empty-answer', `${node.id}: an answer is needed`);
        return { ops: [], next: node.next };
      }
      return { ops: node.patch, next: node.next, value };
    }
    case 'confirm-guess':
      if (answer.kind !== 'guess') throw wrong('Right, Sort of or No was expected');
      return { ops: [], next: node.next };
    case 'preview-moment':
    case 'review-queue':
      if (answer.kind !== 'continue') throw wrong('only continuing was expected');
      return { ops: [], next: node.next };
    case 'menu':
      throw wrong('a menu is answered by jumping to one of its entries');
    case 'end':
      throw new MachineError('nothing-to-do', 'The end has nothing to answer');
  }
}

/** The conversation after answering the node it is at. */
export function answer(
  graph: BuilderGraph,
  conversation: Conversation,
  given: Answer,
  context: AnswerContext,
): Conversation {
  if (!Locale.safeParse(context.locale).success) {
    throw new MachineError('wrong-answer', `"${context.locale}" is not a locale`);
  }
  const { state, log } = conversation;
  const node = nodeOf(graph, state.cursor);
  const plan = planFor(graph, node, given);
  const applied = runPatch(state, plan.ops, {
    nodeId: node.id,
    source: 'guided',
    locale: context.locale,
    ...(plan.value === undefined ? {} : { answer: plan.value }),
  });
  checkDraft(applied.state.draft);

  const answered = given.kind === 'jump' ? answeredIds(log) : [...answeredIds(log), node.id];
  const target = pickNext(plan.next, guardState(applied.state, answered));
  const { to, skipped } = settle(graph, applied.state, answered, target);

  const entry: LogEntry = {
    nodeId: node.id,
    answer: given,
    patch: applied.changes,
    inverse: applied.inverse,
    to,
    skipped,
    tier: context.tier ?? null,
    source: 'guided',
  };
  return { base: conversation.base, log: [...log, entry], state: { ...applied.state, cursor: to } };
}

/**
 * A hand edit — inline editing on the preview (S5) — as a step in the same log, as undoable as
 * any answer. Only paths `WRITABLE` allows, with values it accepts; the conversation stays where
 * it is.
 */
export function edit(
  conversation: Conversation,
  ops: readonly Op[],
  context: { readonly locale: string },
): Conversation {
  for (const op of ops) {
    const problem = opProblem(op);
    if (problem) throw new MachineError('not-writable', problem);
  }
  const { state, log } = conversation;
  const applied = runPatch(state, ops, {
    nodeId: state.cursor,
    source: 'manual',
    locale: context.locale,
  });
  checkDraft(applied.state.draft);
  const entry: LogEntry = {
    nodeId: state.cursor,
    answer: { kind: 'edit' },
    patch: applied.changes,
    inverse: applied.inverse,
    to: state.cursor,
    skipped: [],
    tier: null,
    source: 'manual',
  };
  return { base: conversation.base, log: [...log, entry], state: applied.state };
}

// --- Going back -------------------------------------------------------------------------------

/** One step back: the last step's inverse, and the node it answered. */
export function back(conversation: Conversation): Conversation {
  const last = conversation.log[conversation.log.length - 1];
  if (!last) throw new MachineError('nothing-to-do', 'There is nothing to go back to');
  const state = applyAll(conversation.state, last.inverse);
  return {
    base: conversation.base,
    log: conversation.log.slice(0, -1),
    state: { ...state, cursor: last.nodeId },
  };
}

/** The state a log leads to from `base`. Needs no graph: the log holds resolved changes. */
export function replay(base: BuilderState, log: readonly LogEntry[]): BuilderState {
  return log.reduce<BuilderState>(
    (state, entry) => ({ ...applyAll(state, entry.patch), cursor: entry.to }),
    base,
  );
}

/** Back to the moment before step `length` — what a breadcrumb does. */
export function rewind(conversation: Conversation, length: number): Conversation {
  if (!Number.isSafeInteger(length) || length < 0 || length > conversation.log.length) {
    throw new MachineError('nothing-to-do', `There is no step ${length}`);
  }
  const log = conversation.log.slice(0, length);
  return { base: conversation.base, log, state: replay(conversation.base, log) };
}

export interface Crumb {
  /** `rewind(conversation, step)` returns to this node, to answer it again. */
  readonly step: number;
  readonly nodeId: string;
  readonly answer: Answer;
  /** Passed over after this step, greyed in the trail with their reasons. */
  readonly skipped: readonly Skipped[];
}

/** The trail: every answer and jump, in order. Hand edits are in the log, not the trail. */
export function trail(conversation: Conversation): Crumb[] {
  return conversation.log.flatMap((entry, step) =>
    entry.answer.kind === 'edit'
      ? []
      : [{ step, nodeId: entry.nodeId, answer: entry.answer, skipped: entry.skipped }],
  );
}

/** A stored conversation, replayed — and checked, since it came from outside. */
export function resume(base: BuilderState, log: readonly LogEntry[]): Conversation {
  checkDraft(base.draft);
  const state = replay(base, log);
  checkDraft(state.draft);
  return { base, log, state };
}
