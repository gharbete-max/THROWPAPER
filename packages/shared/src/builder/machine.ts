import { LocalisedText, Locale } from '../api/common.js';
import { FormDefinition } from '../forms/definition.js';
import { applyAll, jsonEqual, type Change } from './changes.js';
import { evaluateGuard, parseGuard, type GuardState } from './graph/guards.js';
import { opProblem } from './graph/paths.js';
import {
  takesList,
  type BuilderGraph,
  type Json,
  type MessageKey,
  type Next,
  type Node,
  type Op,
} from './graph/schema.js';
import { runPatch } from './patches.js';
import {
  applyTracked,
  fieldOf,
  fieldPointer,
  guidedView,
  provenancePointer,
  settleQuestions,
  type Tracked,
} from './reconcile.js';
import {
  MachineError,
  type BuilderDraft,
  type MachineErrorCode,
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
  /**
   * A list for a `quantity` whose patch makes options (`$options`): the options themselves, their
   * labels verbatim, their number the count — T6, "Red, Green, Blue" (`INTENT-LADDER.md`).
   */
  | { readonly kind: 'list'; readonly labels: readonly string[] }
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
  /**
   * The node answered — or the cursor, for a jump or a hand edit. An answer given ahead of its
   * turn (`answerAt`) names the node it answered, which is not where the conversation was: Back
   * returns to where it was, the `to` of the step before.
   */
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

/**
 * The conversation as guards read it — what the ladder checks another question against before it
 * offers it (T6, T7): a node whose `when` is false here is not one the conversation could ask.
 */
export function guardStateOf(conversation: Conversation): GuardState {
  return guardState(conversation.state, answeredIds(conversation.log));
}

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
 * The guard state as if nothing were decided for the question in focus. A jump is the person asking
 * for that node by name: what an import or an earlier sentence decided does not hide it from them.
 */
function undecided(guards: GuardState, state: BuilderState): GuardState {
  const record = state.focus === null ? undefined : state.sidecar.fields[state.focus];
  if (state.focus === null || record?.decided === undefined) return guards;
  const { decided: _decided, ...rest } = record;
  const fields = { ...state.sidecar.fields, [state.focus]: rest };
  return { ...guards, sidecar: { ...state.sidecar, fields } };
}

/**
 * From `target`, past every node whose `when` is false, to the node to ask. Bounded by the size of
 * the graph: rule G6 refuses a cycle of unconditional edges, and this refuses to go round anyway.
 * `asked`: the target was asked for by name (a jump), so it is not passed over for being decided.
 */
function settle(
  graph: BuilderGraph,
  state: BuilderState,
  answered: readonly string[],
  target: string,
  asked = false,
): { to: string; skipped: Skipped[] } {
  const guards = guardState(state, answered);
  const skipped: Skipped[] = [];
  let id = target;
  for (let hops = 0; hops <= graph.nodes.length; hops += 1) {
    const node = nodeOf(graph, id);
    const here = asked && hops === 0 ? undecided(guards, state) : guards;
    if (node.when === undefined || holds(node.when, here)) return { to: id, skipped };
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
): { ops: readonly Op[]; next: Next; value?: number | string | readonly string[] } {
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
      if (answer.kind === 'list') {
        // Only where the answer is the options themselves: `$options` is what reads a list.
        if (!takesList(node)) throw wrong('a number was expected');
        const labels = answer.labels.map((label) => label.trim());
        if (labels.some((label) => label === '')) {
          throw new MachineError('empty-answer', `${node.id}: an option has no words`);
        }
        if (labels.length < node.min || labels.length > node.max) {
          throw new MachineError(
            'out-of-range',
            `${node.id}: ${labels.length} options is not ${node.min}–${node.max}`,
          );
        }
        return { ops: node.patch, next: node.next, value: labels };
      }
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

/**
 * A guided step's patch applied to the state. Reconciliation (`reconcile.ts`): the step runs on the
 * conversation's own versions of the questions, and never changes one a person has changed by hand
 * — it proposes instead.
 */
function guidedStep(
  state: BuilderState,
  node: Node,
  plan: ReturnType<typeof planFor>,
  context: AnswerContext,
): { settled: BuilderState; tracked: Tracked } {
  const tracked: Tracked = { changes: [], inverse: [] };
  const view = guidedView(state, tracked);
  const applied = runPatch(view, plan.ops, {
    nodeId: node.id,
    source: 'guided',
    locale: context.locale,
    ...(plan.value === undefined ? {} : { answer: plan.value }),
  });
  tracked.changes.push(...applied.changes);
  tracked.inverse = [...applied.inverse, ...tracked.inverse];
  const settled = applyTracked(applied.state, settleQuestions(state, view, applied.state), tracked);
  checkDraft(settled.draft);
  return { settled, tracked };
}

function checkLocale(context: AnswerContext): void {
  if (!Locale.safeParse(context.locale).success) {
    throw new MachineError('wrong-answer', `"${context.locale}" is not a locale`);
  }
}

/** The conversation after answering the node it is at. */
export function answer(
  graph: BuilderGraph,
  conversation: Conversation,
  given: Answer,
  context: AnswerContext,
): Conversation {
  checkLocale(context);
  const { state, log } = conversation;
  const node = nodeOf(graph, state.cursor);
  const plan = planFor(graph, node, given);
  const { settled, tracked } = guidedStep(state, node, plan, context);

  const jump = given.kind === 'jump';
  const answered = jump ? answeredIds(log) : [...answeredIds(log), node.id];
  const target = pickNext(plan.next, guardState(settled, answered));
  const { to, skipped } = settle(graph, settled, answered, target, jump);

  const entry: LogEntry = {
    nodeId: node.id,
    answer: given,
    patch: tracked.changes,
    inverse: tracked.inverse,
    to,
    skipped,
    tier: context.tier ?? null,
    source: 'guided',
  };
  return { base: conversation.base, log: [...log, entry], state: { ...settled, cursor: to } };
}

/**
 * An answer to a node ahead of the conversation's turn: "three buttons, pill shape, side by side"
 * answers the shape and the placement while the conversation is still asking about buttons (T5,
 * `INTENT-LADDER.md`). A step like any other — in the log, in the trail, undone by Back — and the
 * conversation stays where it is. For the node the conversation is at, this is `answer`.
 *
 * Only a node the conversation could ask now (its `when` holds), and only one that settles a slot:
 * the step marks the slot decided for the question in focus, so the conversation passes the node
 * by when it gets there instead of asking again (rule G14). A node with no slot has nothing to
 * mark, and is answered only in its turn.
 */
export function answerAt(
  graph: BuilderGraph,
  conversation: Conversation,
  nodeId: string,
  given: Answer,
  context: AnswerContext,
): Conversation {
  const { state, log } = conversation;
  if (nodeId === state.cursor) return answer(graph, conversation, given, context);
  checkLocale(context);
  const node = nodeOf(graph, nodeId);
  const slot = node.slot;
  if (!slot) throw new MachineError('not-now', `${node.id} is answered only in its turn`);
  if (given.kind === 'jump' || given.kind === 'edit') {
    throw new MachineError('wrong-answer', `${node.id}: a ${given.kind} is not an answer`);
  }
  if (node.when !== undefined && !holds(node.when, guardState(state, answeredIds(log)))) {
    throw new MachineError('not-now', `${node.id} is not asked now`);
  }
  if (state.focus === null) throw new MachineError('no-focus', 'No question is in focus');
  const plan = planFor(graph, node, given);
  const { settled, tracked } = guidedStep(state, node, plan, context);

  const focus = settled.focus;
  const record = focus === null ? undefined : settled.sidecar.fields[focus];
  const marked =
    focus === null || record?.decided?.[slot] === true
      ? settled
      : applyTracked(
          settled,
          [
            record
              ? { op: 'set', at: provenancePointer(focus, 'decided', slot), value: true }
              : {
                  op: 'set',
                  at: provenancePointer(focus),
                  value: { source: 'manual', decided: { [slot]: true } },
                },
          ],
          tracked,
        );

  const answered = [...answeredIds(log), node.id];
  const { to, skipped } = settle(graph, marked, answered, state.cursor);
  const entry: LogEntry = {
    nodeId: node.id,
    answer: given,
    patch: tracked.changes,
    inverse: tracked.inverse,
    to,
    skipped,
    tier: context.tier ?? null,
    source: 'guided',
  };
  return { base: conversation.base, log: [...log, entry], state: { ...marked, cursor: to } };
}

/** One of several answers given at once, to the node it answers. */
export interface Given {
  readonly nodeId: string;
  readonly answer: Answer;
  readonly tier: Tier | null;
}

export interface Filled {
  readonly conversation: Conversation;
  /** For each answer given, in order: null when it became a step, or why the machine refused it. */
  readonly refused: readonly (MachineErrorCode | null)[];
}

/**
 * Several answers at once — a sentence that said several things (T5), or a guess confirmed (T7) —
 * each its own step, so each is undone by Back on its own. Given in the graph's order: an answer to
 * the node the conversation is at is answered in its turn and the conversation moves on, so the
 * next may be answered in its turn too; the others are answered ahead of theirs (`answerAt`). One
 * the machine refuses — not askable now, or breaking the form — is left out and said so; the rest
 * still stand.
 */
export function fill(
  graph: BuilderGraph,
  conversation: Conversation,
  answers: readonly Given[],
  context: { readonly locale: string },
): Filled {
  let here = conversation;
  const refused: (MachineErrorCode | null)[] = [];
  for (const one of answers) {
    try {
      here = answerAt(graph, here, one.nodeId, one.answer, {
        locale: context.locale,
        tier: one.tier,
      });
      refused.push(null);
    } catch (error) {
      if (!(error instanceof MachineError)) throw error;
      refused.push(error.code);
    }
  }
  return { conversation: here, refused };
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

// --- Reconciling ------------------------------------------------------------------------------

/** A step the person took about a question, not an answer: in the log, out of the trail. */
function personStep(conversation: Conversation, changes: readonly Change[]): Conversation {
  const { state, log } = conversation;
  const tracked: Tracked = { changes: [], inverse: [] };
  const next = applyTracked(state, changes, tracked);
  checkDraft(next.draft);
  const entry: LogEntry = {
    nodeId: state.cursor,
    answer: { kind: 'edit' },
    patch: tracked.changes,
    inverse: tracked.inverse,
    to: state.cursor,
    skipped: [],
    tier: null,
    source: 'manual',
  };
  return { base: conversation.base, log: [...log, entry], state: next };
}

/**
 * "Keep mine": the person's version stays, and the conversation's proposal for it is dropped. The
 * question is still changed by hand, so the next step that would change it asks again.
 */
export function keepMine(conversation: Conversation, fieldId: string): Conversation {
  if (conversation.state.sidecar.fields[fieldId]?.proposal === undefined) {
    throw new MachineError('nothing-to-do', `${fieldId} has nothing waiting`);
  }
  return personStep(conversation, [{ op: 'unset', at: provenancePointer(fieldId, 'proposal') }]);
}

/**
 * "Use guided", and the badge's "Revert to guided": the question becomes the conversation's
 * version — what it proposed, or else what it last made — and is no longer changed by hand. A
 * step like any other: Back puts the person's version back.
 */
export function takeGuided(conversation: Conversation, fieldId: string): Conversation {
  const { state } = conversation;
  const provenance = state.sidecar.fields[fieldId];
  const target = provenance?.proposal ?? provenance?.guided;
  if (target === undefined || !fieldOf(state, fieldId)) {
    throw new MachineError('nothing-to-do', `${fieldId} has no guided version`);
  }
  const changes: Change[] = [
    { op: 'set', at: fieldPointer(fieldId), value: target },
    { op: 'set', at: provenancePointer(fieldId, 'guided'), value: target },
  ];
  if (provenance?.proposal !== undefined) {
    changes.push({ op: 'unset', at: provenancePointer(fieldId, 'proposal') });
  }
  return personStep(conversation, changes);
}

/**
 * The conversation carried on over a draft changed outside it — in the classic editor. The draft
 * is taken as it now is, whole; the sidecar keeps every baseline, so what was changed there shows
 * as changed by hand, and the conversation proposes rather than writes over it.
 *
 * The log starts again: going back past this point would mean undoing the editor's changes from
 * here, which is exactly what must never happen. The conversation stays at its node, unless the
 * question it was building was deleted there: then it goes to the menu.
 */
export function rebase(
  graph: BuilderGraph,
  conversation: Conversation,
  draft: BuilderDraft,
): Conversation {
  checkDraft(draft);
  const { state } = conversation;
  const kept =
    state.focus === null || draft.definition.fields.some((field) => field.id === state.focus);
  const moved: BuilderState = { ...state, draft, focus: kept ? state.focus : null };
  // The question being built is gone: its node has nothing to write to, so the conversation goes
  // to the menu — "What do you want to change?" — rather than to a question it cannot take.
  const from = kept
    ? state.cursor
    : (graph.nodes.find((n) => n.kind === 'menu')?.id ?? graph.start);
  const base = { ...moved, cursor: settle(graph, moved, [], from).to };
  return { base, log: [], state: base };
}

// --- Going back -------------------------------------------------------------------------------

/**
 * One step back: the last step's inverse, and back where the conversation was when it was taken —
 * the node it answered, or, for an answer given ahead of its turn, the node that was being asked.
 */
export function back(conversation: Conversation): Conversation {
  const { log } = conversation;
  const last = log[log.length - 1];
  if (!last) throw new MachineError('nothing-to-do', 'There is nothing to go back to');
  const state = applyAll(conversation.state, last.inverse);
  const cursor = log[log.length - 2]?.to ?? conversation.base.cursor;
  return { base: conversation.base, log: log.slice(0, -1), state: { ...state, cursor } };
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
