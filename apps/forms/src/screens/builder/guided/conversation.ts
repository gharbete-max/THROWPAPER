import {
  MachineError,
  answer as answerNode,
  back as backOne,
  begin,
  currentNode,
  fromSession,
  jsonEqual,
  jumpTargets,
  optionsOf,
  rewind,
  trail,
  type Answer,
  type BuilderGraph,
  type Conversation,
  type MessageKey,
  type Node,
  type Tier,
} from '@tp/shared/builder';
import type { FormDefinition } from '@tp/shared/forms';
import { interpret, toAnswer, type AskReason, type Reading } from '@tp/shared/interpret';

/**
 * The guided builder's screen logic, with nothing on screen — so every rule here is a function a
 * test can call (`conversation.test.ts`). The machine (`@tp/shared/builder`) decides what happens;
 * this file only turns what the person did into the machine's calls, and the machine's state into
 * what the screen shows. Components render; they never decide (`DESIGN-LANGUAGE.md`,
 * "Components").
 */

export type Started =
  | { readonly kind: 'resumed'; readonly conversation: Conversation }
  | {
      readonly kind: 'fresh';
      readonly conversation: Conversation;
      /**
       * Why a saved conversation was not resumed: it no longer describes the form (the form was
       * edited in the editor since, or the session's save failed after the draft's), or it could
       * not be read. Either way the form as it is wins, and nothing the person made is
       * overwritten.
       */
      readonly discarded: 'changed-elsewhere' | 'unreadable' | null;
    };

/**
 * Where to begin: the saved conversation, if it still describes the draft exactly — otherwise a
 * new one over the draft as it stands. Never the other way round: resuming a conversation whose
 * draft differs would save that draft over edits made in the classic editor (`CLAUDE.md`,
 * "Never destroy user text or edits"). S5's reconciliation will do better than starting again.
 */
export function startConversation(input: {
  readonly graph: BuilderGraph;
  readonly definition: FormDefinition;
  readonly title: Record<string, string>;
  readonly stored: unknown;
  readonly brandKitExists: boolean;
}): Started {
  const fresh = () =>
    begin(input.graph, {
      definition: input.definition,
      title: input.title,
      pending: { brandKitExists: input.brandKitExists },
    });
  if (input.stored === null || input.stored === undefined) {
    return { kind: 'fresh', conversation: fresh(), discarded: null };
  }
  try {
    const conversation = fromSession(input.stored);
    if (jsonEqual(conversation.state.draft.definition, input.definition)) {
      return { kind: 'resumed', conversation };
    }
    return { kind: 'fresh', conversation: fresh(), discarded: 'changed-elsewhere' };
  } catch (error) {
    if (!(error instanceof MachineError)) throw error;
    return { kind: 'fresh', conversation: fresh(), discarded: 'unreadable' };
  }
}

export interface Locales {
  /** What the author reads and types in: the ladder reads free text in this language. */
  readonly interfaceLocale: string;
  /** What the form is written in: a label typed as an answer is stored in this language. */
  readonly contentLocale: string;
}

export type Stepped =
  | { readonly kind: 'stepped'; readonly conversation: Conversation }
  /** The machine refused the step (it would break the form); nothing changed. */
  | { readonly kind: 'refused'; readonly code: MachineError['code'] };

/** One answer, pressed or typed into a text-entry node. */
export function choose(
  graph: BuilderGraph,
  conversation: Conversation,
  given: Answer,
  locales: Locales,
  tier: Tier | null = null,
): Stepped {
  try {
    return {
      kind: 'stepped',
      conversation: answerNode(graph, conversation, given, {
        locale: locales.contentLocale,
        tier,
      }),
    };
  } catch (error) {
    if (!(error instanceof MachineError)) throw error;
    return { kind: 'refused', code: error.code };
  }
}

export type Typed =
  | { readonly kind: 'stepped'; readonly conversation: Conversation; readonly reading: Reading }
  | { readonly kind: 'ask'; readonly reason: AskReason; readonly options: readonly Reading[] }
  | { readonly kind: 'refused'; readonly code: MachineError['code'] };

/**
 * Free text at the current node, read by the ladder (`INTENT-LADDER.md`). Applied only when a
 * rung clears its threshold, and then as an ordinary step with its tier — undone by Back like any
 * other. Below every threshold it asks, and the conversation stays where it is.
 */
export function typed(
  graph: BuilderGraph,
  conversation: Conversation,
  text: string,
  locales: Locales,
): Typed {
  const node = currentNode(graph, conversation);
  const read = interpret(text, { graph, nodeId: node.id, locale: locales.interfaceLocale });
  if (read.outcome === 'ask') return { kind: 'ask', reason: read.reason, options: read.options };
  const stepped = choose(
    graph,
    conversation,
    toAnswer(graph, read.reading),
    locales,
    read.reading.tier,
  );
  return stepped.kind === 'stepped' ? { ...stepped, reading: read.reading } : stepped;
}

/** Whether the "Or type it" box is offered: only where free text chooses an answer. */
export function readsFreeText(node: Node): boolean {
  return (
    node.kind === 'question' ||
    node.kind === 'pick-one' ||
    node.kind === 'pick-many' ||
    node.kind === 'quantity'
  );
}

/** Back one step; nothing to go back to is not an error, it is the start. */
export function stepBack(conversation: Conversation): Conversation {
  return conversation.log.length === 0 ? conversation : backOne(conversation);
}

/**
 * The answer given at a step, so the screen can put focus back on it when the person returns to
 * that question (`DESIGN-LANGUAGE.md`, "Keyboard": "back to the answer that was chosen on Back").
 * Null for an answer that is not one of the node's buttons — a number, words, several at once.
 */
export function choiceAt(conversation: Conversation, step: number): string | null {
  const given = conversation.log[step]?.answer;
  if (!given) return null;
  if (given.kind === 'option') return given.optionId;
  if (given.kind === 'jump') return given.to;
  if (given.kind === 'guess') return given.verdict;
  return null;
}

/** The answer given at the step Back would undo. */
export function lastChoice(conversation: Conversation): string | null {
  return choiceAt(conversation, conversation.log.length - 1);
}

/**
 * Whether the screen shows the live preview: on a preview moment, and on the screen right after a
 * node whose `preview` names what to render after it — so the control appears once its shape has
 * been answered, and again at the end (`PREDICTIVE-BUILDER.md`, acceptance S2).
 */
export function showsPreview(graph: BuilderGraph, conversation: Conversation): boolean {
  if (currentNode(graph, conversation).kind === 'preview-moment') return true;
  const last = conversation.log.at(-1);
  if (!last || last.answer.kind === 'jump') return false;
  const answered = graph.nodes.find((n) => n.id === last.nodeId);
  return answered?.preview !== undefined && answered.kind !== 'preview-moment';
}

/** An answer, as the trail says it: a message key, or the words the person gave. */
export type Said = { readonly key: MessageKey } | { readonly text: string };

export interface Crumb {
  /** `rewind(conversation, step)` returns to this node, to answer it again. */
  readonly step: number;
  readonly nodeId: string;
  /** The question it answered. */
  readonly question: MessageKey;
  readonly said: readonly Said[];
  /** Questions passed over after it, and why — greyed in the trail. */
  readonly skipped: readonly { readonly question: MessageKey; readonly reason: MessageKey }[];
}

const GUESS: Record<'right' | 'sort-of' | 'no', MessageKey> = {
  right: 'guided.guess.right',
  'sort-of': 'guided.guess.sortOf',
  no: 'guided.guess.no',
};

/** The trail, in words: every answer and jump, each a way back to its question. */
export function crumbs(graph: BuilderGraph, conversation: Conversation): Crumb[] {
  const nodeOf = (id: string) => graph.nodes.find((n) => n.id === id);
  const askOf = (id: string): MessageKey => nodeOf(id)?.ask ?? 'guided.end.ask';
  return trail(conversation).map((crumb) => {
    const node = nodeOf(crumb.nodeId);
    const labelOf = (optionId: string): Said => {
      const option = node ? optionsOf(node).find((o) => o.id === optionId) : undefined;
      return option ? { key: option.label } : { text: optionId };
    };
    const { answer } = crumb;
    const said: Said[] =
      answer.kind === 'option'
        ? [labelOf(answer.optionId)]
        : answer.kind === 'options'
          ? answer.optionIds.map(labelOf)
          : answer.kind === 'quantity'
            ? [{ text: String(answer.value) }]
            : answer.kind === 'text'
              ? [{ text: answer.value }]
              : answer.kind === 'guess'
                ? [{ key: GUESS[answer.verdict] }]
                : answer.kind === 'jump'
                  ? [{ key: askOf(answer.to) }]
                  : [];
    return {
      step: crumb.step,
      nodeId: crumb.nodeId,
      question: askOf(crumb.nodeId),
      said,
      skipped: crumb.skipped.map((s) => ({ question: askOf(s.nodeId), reason: s.reason })),
    };
  });
}

/** Back to a crumb's question, to answer it again. */
export function backTo(conversation: Conversation, step: number): Conversation {
  return rewind(conversation, step);
}

/**
 * Where "Show all options" may go from here — the node's way out — each named by its question.
 * The current node is left out: going to where you are is not a way out.
 */
export function wayOut(
  graph: BuilderGraph,
  conversation: Conversation,
): { readonly nodeId: string; readonly question: MessageKey }[] {
  const here = conversation.state.cursor;
  return jumpTargets(graph, here)
    .filter((id) => id !== here)
    .flatMap((id) => {
      const node = graph.nodes.find((n) => n.id === id);
      return node ? [{ nodeId: id, question: node.ask }] : [];
    });
}

/** The question in focus, if the conversation has one: what a preview shows. */
export function focusedField(conversation: Conversation) {
  const { focus, draft } = conversation.state;
  return focus === null ? null : (draft.definition.fields.find((f) => f.id === focus) ?? null);
}
