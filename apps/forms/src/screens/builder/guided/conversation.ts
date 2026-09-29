import {
  MachineError,
  answer as answerNode,
  back as backOne,
  begin,
  currentNode,
  fill,
  fromSession,
  guardStateOf,
  jsonEqual,
  jumpTargets,
  optionsOf,
  rebase,
  resume,
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
import {
  aliasRefusal,
  interpret,
  languageOf,
  toAnswer,
  type AliasEntry,
  type AliasRefusalReason,
  type AskReason,
  type Reading,
  type RememberAlias,
} from '@tp/shared/interpret';

/**
 * The guided builder's screen logic, with nothing on screen — so every rule here is a function a
 * test can call (`conversation.test.ts`). The machine (`@tp/shared/builder`) decides what happens;
 * this file only turns what the person did into the machine's calls, and the machine's state into
 * what the screen shows. Components render; they never decide (`DESIGN-LANGUAGE.md`,
 * "Components").
 */

export type Started =
  | {
      readonly kind: 'resumed';
      readonly conversation: Conversation;
      /**
       * The form was changed outside the conversation since it was saved — in the classic editor,
       * or by a save that failed half way. The conversation carries on over the form as it now is
       * (`rebase`): what was changed there shows as changed by hand and is never written over.
       */
      readonly rebased: boolean;
    }
  | {
      readonly kind: 'fresh';
      readonly conversation: Conversation;
      /** A saved conversation this build could not read: the form as it is starts a new one. */
      readonly discarded: 'unreadable' | null;
    };

/**
 * Where to begin: the saved conversation, carried on over the form as it is now; or a new one when
 * there is none or it cannot be read. The form always wins over the saved draft — resuming never
 * saves an older draft over edits made since (`CLAUDE.md`, "Never destroy user text or edits";
 * `CAVEATS.md` #75), and those edits are reconciled rather than discarded.
 *
 * The facts the screen provides (the graph's `inputs`) are today's, on a resumed conversation too:
 * a brand kit made since, or a role changed since, decides what is asked from here on. What was
 * asked before stays as it was; the log records where each answer led.
 */
export function startConversation(input: {
  readonly graph: BuilderGraph;
  readonly definition: FormDefinition;
  readonly title: Record<string, string>;
  readonly stored: unknown;
  readonly brandKitExists: boolean;
  /** An administrator: only they may change the organisation's colours (owner question 8). */
  readonly canChangeBrand: boolean;
}): Started {
  const inputs = { brandKitExists: input.brandKitExists, canChangeBrand: input.canChangeBrand };
  const fresh = () =>
    begin(input.graph, { definition: input.definition, title: input.title, pending: inputs });
  if (input.stored === null || input.stored === undefined) {
    return { kind: 'fresh', conversation: fresh(), discarded: null };
  }
  let saved: Conversation;
  try {
    const stored = fromSession(input.stored);
    saved = resume({ ...stored.base, pending: { ...stored.base.pending, ...inputs } }, stored.log);
  } catch (error) {
    if (!(error instanceof MachineError)) throw error;
    return { kind: 'fresh', conversation: fresh(), discarded: 'unreadable' };
  }
  const draft = { definition: input.definition, title: input.title };
  if (jsonEqual(saved.state.draft, draft)) {
    return { kind: 'resumed', conversation: saved, rebased: false };
  }
  return { kind: 'resumed', conversation: rebase(input.graph, saved, draft), rebased: true };
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

/**
 * The organisation's colours, as the conversation may change them (owner question 8): whether this
 * person may (an administrator), and the change itself — the brand kit, made or replaced with a
 * preset — which the screen makes only after "Use these colours". It says whether it was saved.
 */
export interface Colours {
  readonly canChange: boolean;
  readonly apply: (presetId: string) => Promise<boolean>;
}

/**
 * The preset a step chose ("Which colours should your form use?"), or null. It can take effect
 * only through the brand kit, which is every form's and every mail's, so the screen holds a step
 * that chose one until an administrator confirms it — and never takes it for anyone else. Read
 * from the changes the step made, not from which node it answered, so a preset pressed, typed or
 * picked from the answers offered is held alike, and choosing the one already chosen is held again.
 */
export function presetChosen(before: Conversation, after: Conversation): string | null {
  const steps = after.log.slice(before.log.length);
  for (const entry of steps) {
    for (const change of entry.patch) {
      if (
        change.op === 'set' &&
        change.at.length === 2 &&
        change.at[0] === 'pending' &&
        change.at[1] === 'themePreset' &&
        typeof change.value === 'string'
      ) {
        return change.value;
      }
    }
  }
  return null;
}

/** What the conversation learns with: the aliases it reads, and the "Remember" press. */
export interface Learning {
  /** The built-in aliases and the organisation's learned ones. */
  readonly aliases: readonly AliasEntry[];
  readonly remember: (offer: RememberAlias) => Promise<Remembered>;
}

export type Remembered =
  | { readonly kind: 'remembered' }
  /** It already means something — `means`, for a collision — or cannot be remembered at all. */
  | { readonly kind: 'refused'; readonly reason: AliasRefusalReason; readonly means?: string }
  | { readonly kind: 'failed' };

/** A part of what was typed that answered nothing, and why. */
export interface Unused {
  readonly text: string;
  /**
   * `nothing` — read as no answer; `conflict` — contradicted by another part ("pill, square");
   * `not-now` — an answer to a question the conversation cannot ask yet, or any more.
   */
  readonly why: 'nothing' | 'conflict' | 'not-now';
}

/** Another question of the group the words may have been about, named by its question. */
export interface Elsewhere {
  readonly nodeId: string;
  readonly question: MessageKey;
}

export type Typed =
  /**
   * Read, and done: one step, or — a sentence that said several things (T5) — one step each, in
   * the graph's order. What was read, and what was not used.
   */
  | {
      readonly kind: 'stepped';
      readonly conversation: Conversation;
      readonly readings: readonly Reading[];
      readonly unused: readonly Unused[];
    }
  /** T7: about another question, clearly — but asked before anything happens. */
  | { readonly kind: 'guess'; readonly reading: Reading }
  | {
      readonly kind: 'ask';
      readonly reason: AskReason;
      readonly options: readonly Reading[];
      readonly elsewhere: readonly Elsewhere[];
    }
  | { readonly kind: 'refused'; readonly code: MachineError['code'] };

/** Readings, as the machine takes them: each to the node it answers, with its tier. */
function given(graph: BuilderGraph, readings: readonly Reading[]) {
  return readings.map((reading) => ({
    nodeId: reading.nodeId,
    answer: toAnswer(graph, reading),
    tier: reading.tier,
  }));
}

/**
 * Readings applied — each its own step (`fill`). Ones the machine refuses are left out and said
 * so; if it refuses all of them, nothing happened.
 */
function applied(
  graph: BuilderGraph,
  conversation: Conversation,
  text: string,
  readings: readonly Reading[],
  unused: readonly Unused[],
  locales: Locales,
): Typed {
  const filled = fill(graph, conversation, given(graph, readings), {
    locale: locales.contentLocale,
  });
  const first = filled.refused.find((code) => code !== null);
  if (filled.refused.every((code) => code !== null)) {
    return { kind: 'refused', code: first ?? 'wrong-answer' };
  }
  const notNow: Unused[] = readings.flatMap((reading, i) =>
    filled.refused[i] === null
      ? []
      : [{ text: text.slice(...reading.evidenceSpan), why: 'not-now' as const }],
  );
  return {
    kind: 'stepped',
    conversation: filled.conversation,
    readings: readings.filter((_, i) => filled.refused[i] === null),
    unused: [...unused, ...notNow],
  };
}

/**
 * Free text at the current node, read by the ladder (`INTENT-LADDER.md`) with the organisation's
 * learned aliases, against the conversation as it stands: a question it could not ask now is
 * never offered. Applied only when a rung clears its threshold, each answer as an ordinary step
 * with its tier — undone by Back like any other. A guess waits to be confirmed; below every
 * threshold the ladder asks, and the conversation stays where it is.
 */
export function typed(
  graph: BuilderGraph,
  conversation: Conversation,
  text: string,
  locales: Locales,
  aliases?: readonly AliasEntry[],
): Typed {
  const node = currentNode(graph, conversation);
  const read = interpret(text, {
    graph,
    nodeId: node.id,
    locale: locales.interfaceLocale,
    ...(aliases ? { aliases } : {}),
    state: guardStateOf(conversation),
  });
  switch (read.outcome) {
    case 'ask':
      return {
        kind: 'ask',
        reason: read.reason,
        options: read.options,
        elsewhere: read.elsewhere.flatMap((other) => {
          const target = graph.nodes.find((n) => n.id === other.nodeId);
          return target ? [{ nodeId: target.id, question: target.ask }] : [];
        }),
      };
    case 'guess':
      return { kind: 'guess', reading: read.reading };
    case 'fill':
      return applied(
        graph,
        conversation,
        text,
        read.readings,
        read.unused.map((u) => ({ text: text.slice(...u.span), why: u.why })),
        locales,
      );
    case 'apply':
      return applied(graph, conversation, text, [read.reading], [], locales);
  }
}

/** A guess (T7), confirmed: the answer it guessed, as a step. */
export function confirmGuess(
  graph: BuilderGraph,
  conversation: Conversation,
  text: string,
  reading: Reading,
  locales: Locales,
): Typed {
  return applied(graph, conversation, text, [{ ...reading, tier: 'T7' }], [], locales);
}

/** The node's own options, as the menu a question that could not be read offers (T8). */
export function askMenu(graph: BuilderGraph, nodeId: string): Reading[] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return (node ? optionsOf(node) : []).map((option) => ({
    nodeId,
    optionId: option.id,
    value: null,
    confidence: 0,
    tier: 'T8' as const,
    evidenceSpan: [0, 0] as const,
    alternatives: [],
  }));
}

/**
 * "Remember '…' as a way to say this?" — offered after a person picks an answer from the menu of
 * something the ladder could not read (T8), and only when remembering it could work: a phrase of
 * 1–80 characters, for one of the node's options, that does not already mean something
 * (`aliasRefusal`). Nothing is stored until the person presses Remember.
 */
export function rememberOffer(
  graph: BuilderGraph,
  text: string,
  picked: Reading,
  locales: Locales,
  known: readonly AliasEntry[],
): RememberAlias | null {
  const phrase = text.trim();
  const language = languageOf(locales.interfaceLocale);
  if (!language || picked.optionId === null || phrase === '') return null;
  const wanted: RememberAlias = {
    phrase,
    nodeId: picked.nodeId,
    optionId: picked.optionId,
    locale: language,
  };
  return aliasRefusal(graph, wanted, known) ? null : wanted;
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

/** Which preview a screen shows, named as the graph names it: a control, or the masthead. */
export type PreviewSpec = 'choice.control' | 'brand.masthead';

/**
 * The preview a screen shows, or null: on a preview moment, its own; on the screen right after a
 * node whose `preview` names what to render after it — so the control appears once its shape has
 * been answered, and again at the end (`PREDICTIVE-BUILDER.md`, acceptance S2). "Show me" asks for
 * one anywhere a question is in focus.
 */
export function previewOf(
  graph: BuilderGraph,
  conversation: Conversation,
  showMe = false,
): PreviewSpec | null {
  const node = currentNode(graph, conversation);
  const named = (spec: string | undefined): PreviewSpec | null =>
    spec === 'choice.control' || spec === 'brand.masthead' ? spec : null;
  if (node.kind === 'preview-moment') return named(node.preview);
  const last = conversation.log
    .filter((entry) => entry.answer.kind !== 'edit' && entry.answer.kind !== 'import')
    .at(-1);
  if (last && last.answer.kind !== 'jump' && last.to === node.id) {
    const answered = graph.nodes.find((n) => n.id === last.nodeId);
    if (answered?.kind !== 'preview-moment') {
      const spec = named(answered?.preview);
      if (spec) return spec;
    }
  }
  return showMe && conversation.state.focus !== null ? 'choice.control' : null;
}

/** Whether the screen shows a preview at all (see `previewOf`). */
export function showsPreview(graph: BuilderGraph, conversation: Conversation): boolean {
  return previewOf(graph, conversation) !== null;
}

/**
 * The trail's words for questions read from a document (S10): the screen's own, not the graph's,
 * since `guided.*` holds exactly the graph's strings (`guided-graph.test.ts`).
 */
type ImportWords = 'conversation.import.ask' | 'conversation.import.said';

/**
 * An answer, as the trail says it: a message key (with its numbers, for an import's count), or the
 * words the person gave.
 */
export type Said =
  | { readonly key: MessageKey | ImportWords; readonly values?: Readonly<Record<string, number>> }
  | { readonly text: string };

export interface Crumb {
  /** `rewind(conversation, step)` returns to this node, to answer it again. */
  readonly step: number;
  readonly nodeId: string;
  /** The question it answered; for an import, where its questions came from. */
  readonly question: MessageKey | ImportWords;
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
    // Questions read from a document (S10): not an answer to the node the conversation was at.
    if (crumb.answer.kind === 'import') {
      return {
        step: crumb.step,
        nodeId: crumb.nodeId,
        question: 'conversation.import.ask',
        said: [{ key: 'conversation.import.said', values: { count: crumb.answer.count } }],
        skipped: [],
      };
    }
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

/**
 * "What Loppa assumed": the last few decisions, newest first, each a way back to its question
 * (`PREDICTIVE-BUILDER.md`, "The preview contract"). Jumps say where, not what, so they are left
 * out.
 */
export function assumed(graph: BuilderGraph, conversation: Conversation, count = 3): Crumb[] {
  return crumbs(graph, conversation)
    .filter((crumb) => conversation.log[crumb.step]?.answer.kind !== 'jump')
    .slice(-count)
    .reverse();
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
