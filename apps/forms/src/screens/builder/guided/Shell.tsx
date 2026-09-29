import { useEffect, useRef, useState } from 'react';
import type { LocaleConfig } from '@tp/i18n';
import {
  MachineError,
  currentNode,
  edit,
  keepMine,
  optionsOf,
  proposals,
  rewind,
  takeGuided,
  type Answer,
  type BuilderGraph,
  type Conversation,
  type Op,
} from '@tp/shared/builder';
import {
  MAX_LIST,
  toAnswer,
  type AskReason,
  type Reading,
  type RememberAlias,
} from '@tp/shared/interpret';
import { Icon } from '../../../components/Icon.js';
import { useT } from '../../../lib/i18n.js';
import { useReducedMotion } from '../../../lib/motion.js';
import {
  askMenu,
  backTo,
  choiceAt,
  choose,
  confirmGuess,
  lastChoice,
  presetChosen,
  previewOf,
  readsFreeText,
  rememberOffer,
  stepBack,
  typed,
  wayOut,
  type Colours,
  type Elsewhere,
  type Learning,
  type Locales,
  type Unused,
} from './conversation.js';
import { digitOfCode, keyAction } from './keyboard.js';
import { NodeView } from './NodeView.js';
import { PreviewMoment, type PreviewBrand } from './PreviewMoment.js';
import { Reconcile } from './Reconcile.js';
import { Trail } from './Trail.js';

/**
 * The full-screen conversation — `DESIGN-LANGUAGE.md`, "One decision per screen": the trail, the
 * question, its answers, "Or type it", then Back and the way out, always in the same places.
 *
 * It holds only what the screen needs between presses (an open help line, a typed word the ladder
 * asked about); every step is the machine's, through `conversation.ts`, and every key is
 * `keyboard.ts`'s. The conversation itself is the caller's, which saves it.
 */

export interface ShellProps {
  readonly graph: BuilderGraph;
  readonly conversation: Conversation;
  readonly onChange: (next: Conversation) => void;
  readonly locales: Locales;
  /** The organisation's languages, for the preview. */
  readonly contentLocales: LocaleConfig;
  /** The desktop app, where ⌘/Ctrl+1–9 is ours to use. */
  readonly desktop: boolean;
  /** "Build it myself", and the end's "Open it in the editor". */
  readonly onOpenEditor: () => void;
  /** Whether the latest step is saved — shown beside the way out. */
  readonly status?: React.ReactNode;
  /** Whose the form is, for the preview: the organisation's logo, name, and whether it has a kit. */
  readonly brand: PreviewBrand;
  /** The aliases the ladder reads with, and "Remember". Built-in aliases only when absent. */
  readonly learning?: Learning;
  /** Whether this person may change the organisation's colours, and the change. Absent: nobody. */
  readonly colours?: Colours;
}

/** Misses in a row before the conversation stops asking and shows every question of the group. */
const MISSES_BEFORE_LIST = 2;

const ASK: Record<AskReason, string> = {
  nothing: 'conversation.ask.nothing',
  ambiguous: 'conversation.ask.ambiguous',
  negated: 'conversation.ask.negated',
  vague: 'conversation.ask.vague',
  'out-of-range': 'conversation.ask.outOfRange',
  budget: 'conversation.ask.budget',
  'too-long': 'conversation.ask.tooLong',
  'not-readable': 'conversation.ask.notReadable',
};

/** What the ladder said about the last thing typed, and what came of it. */
type Said =
  | {
      readonly kind: 'ask';
      readonly reason: AskReason;
      readonly options: readonly Reading[];
      /** Other questions of the group it may have been about (T7). */
      readonly elsewhere: readonly Elsewhere[];
      /** What was typed: remembered as a way to say the answer picked, if the person wants. */
      readonly text: string;
      /** The second miss in a row: every question of the group is shown instead. */
      readonly listed: boolean;
    }
  | { readonly kind: 'refused' }
  /** T7: "Did you mean …?" — nothing happens until it is answered. */
  | { readonly kind: 'guess'; readonly text: string; readonly reading: Reading }
  /** Applied: the transparency chip, until the next step. */
  | {
      readonly kind: 'read';
      readonly text: string;
      readonly answers: readonly string[];
      readonly unused: readonly Unused[];
      /** The log's length before: "change" goes back there, however many steps it took. */
      readonly from: number;
      readonly atStep: number;
    }
  /** "Remember '…' as a way to say this?", after an answer was picked from the menu. */
  | {
      readonly kind: 'remember';
      readonly offer: RememberAlias;
      readonly label: string;
      readonly atStep: number;
    }
  /** What came of "Remember", or of "Use these colours". */
  | { readonly kind: 'learned'; readonly note: string; readonly atStep: number }
  /**
   * Owner question 8: a step that chose the organisation's colours, held — not taken — until an
   * administrator presses "Use these colours", and then only once the brand kit is saved.
   */
  | {
      readonly kind: 'colours';
      readonly preset: string;
      /** The conversation the step was taken from, and the step. */
      readonly from: Conversation;
      readonly next: Conversation;
      /** What the step would have said, had it not been held. */
      readonly after: Said | null;
      readonly state: 'asking' | 'saving' | 'failed';
    }
  /** Colours chosen by someone who may not change them: never taken, and said why. */
  | { readonly kind: 'coloursRefused' };

/** Where focus goes after "change": back into the box, to edit the words. */
const THE_BOX = '\u0000box';

export function Shell({
  graph,
  conversation,
  onChange,
  locales,
  contentLocales,
  desktop,
  onOpenEditor,
  status,
  brand,
  learning,
  colours,
}: ShellProps) {
  const t = useT();
  const reduced = useReducedMotion();
  const node = currentNode(graph, conversation);
  const step = conversation.log.length;
  /**
   * Where the conversation is, counting answers only. A hand edit or a reconciliation is a step in
   * the log too, but not a move: the screen must not slide, refocus or forget what is open when an
   * option is renamed on the preview.
   */
  const position = conversation.log.filter((entry) => entry.answer.kind !== 'edit').length;
  /** A question the conversation would have changed but a person had: asked before anything else. */
  const waiting = proposals(conversation.state)[0] ?? null;

  const [help, setHelp] = useState(false);
  const [wayOutOpen, setWayOutOpen] = useState(false);
  const [text, setText] = useState('');
  const [said, setSaid] = useState<Said | null>(null);
  /** Free text the ladder asked about, in a row: the second shows the whole group instead. */
  const [misses, setMisses] = useState(0);
  /** Inline editing open on the preview. */
  const [editing, setEditing] = useState(false);
  /** "Show me": the preview of the question in focus, on any screen. */
  const [showMe, setShowMe] = useState(false);
  /** Which way the last move went, for the slide; and what to focus when it lands. */
  const [moved, setMoved] = useState<{ back: boolean; focus: string | null }>({
    back: false,
    focus: null,
  });

  /** The live region's words: the question, then how many answers. */
  const [announcement, setAnnouncement] = useState('');

  /** The node's own answers, without the question's "?" or the preview's controls. */
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  /** "Use these colours": focused when it is asked, so Enter answers it and Tab passes it. */
  const confirmColoursRef = useRef<HTMLButtonElement>(null);
  /** The conversation as it is now, for a save that finishes after the person has moved on. */
  const latest = useRef(conversation);
  useEffect(() => {
    latest.current = conversation;
  });

  /** The label an option id reads as, in the interface language. */
  const labelOf = (optionId: string | null, value: unknown): string => {
    const option = optionsOf(node).find((o) => o.id === optionId);
    return option ? t(option.label) : String(value ?? '');
  };
  /** An option of any question, in words; null when there is no such option. */
  const optionIn = (nodeId: string, optionId: string | null): string | null => {
    const target = graph.nodes.find((n) => n.id === nodeId);
    const option = target ? optionsOf(target).find((o) => o.id === optionId) : undefined;
    return option ? t(option.label) : null;
  };
  /** A reading's answer in words, whichever question it is for: a list is its labels. */
  const answerOf = (reading: Reading): string =>
    optionIn(reading.nodeId, reading.optionId) ??
    (Array.isArray(reading.value) ? reading.value.join(', ') : String(reading.value ?? ''));
  const questionOf = (nodeId: string) => {
    const target = graph.nodes.find((n) => n.id === nodeId);
    return target ? t(target.ask) : '';
  };

  function go(next: Conversation, back: boolean, focus: string | null = null) {
    setHelp(false);
    setWayOutOpen(false);
    setEditing(false);
    // Any move — an answer however given, Back, a jump — ends a run of misses.
    setMisses(0);
    setMoved({ back, focus });
    onChange(next);
  }

  /**
   * A step taken, and what it said shown with it. A step that chose the organisation's colours is
   * held for an administrator's "Use these colours" instead, and is never taken for anyone else
   * (owner question 8): the brand kit is every form's and every mail's.
   */
  function take(next: Conversation, after: Said | null) {
    if (said?.kind === 'colours' && said.state === 'saving') return;
    const preset = presetChosen(conversation, next);
    if (preset !== null) {
      setSaid(
        colours?.canChange
          ? { kind: 'colours', preset, from: conversation, next, after, state: 'asking' }
          : { kind: 'coloursRefused' },
      );
      return;
    }
    setSaid(after);
    setText('');
    go(next, false);
  }

  /** "Use these colours": the brand kit first; the step only once it is saved. */
  async function applyColours(held: Extract<Said, { kind: 'colours' }>) {
    if (!colours) return;
    setSaid({ ...held, state: 'saving' });
    if (!(await colours.apply(held.preset))) {
      setSaid({ ...held, state: 'failed' });
      return;
    }
    // Moved on while it saved: the kit is as confirmed, but a step from elsewhere is not taken.
    if (latest.current !== held.from) {
      setSaid(null);
      return;
    }
    setSaid(
      held.after ?? {
        kind: 'learned',
        note: t('conversation.colours.done'),
        atStep: held.next.log.length,
      },
    );
    setText('');
    go(held.next, false);
  }

  function answer(given: Answer) {
    const result = choose(graph, conversation, given, locales);
    if (result.kind === 'refused') {
      setSaid({ kind: 'refused' });
      return;
    }
    take(result.conversation, null);
  }

  function goBack() {
    // Colours waiting for "Use these colours": Back (and Escape) cancels them first.
    if (said?.kind === 'colours') {
      if (said.state !== 'saving') setSaid(null);
      return;
    }
    if (step === 0) return;
    const focus = lastChoice(conversation);
    setSaid(null);
    go(stepBack(conversation), true, focus);
  }

  function readTyped() {
    if (text.trim() === '') return;
    const result = typed(graph, conversation, text, locales, learning?.aliases);
    if (result.kind === 'ask') {
      const listed = misses + 1 >= MISSES_BEFORE_LIST && wayOut(graph, conversation).length > 0;
      setMisses((count) => count + 1);
      // "Two misses in a row": no third open question — every question of the group, to pick.
      if (listed) setWayOutOpen(true);
      setSaid({
        kind: 'ask',
        reason: result.reason,
        options: result.options,
        elsewhere: result.elsewhere,
        text,
        listed,
      });
      return;
    }
    if (result.kind === 'guess') {
      setSaid({ kind: 'guess', text, reading: result.reading });
      return;
    }
    if (result.kind === 'refused') {
      setSaid({ kind: 'refused' });
      return;
    }
    take(result.conversation, {
      kind: 'read',
      text,
      answers: result.readings.map(answerOf),
      unused: result.unused,
      from: step,
      atStep: result.conversation.log.length,
    });
  }

  /** "Did you mean …?" — yes: the guessed answer, as a step, with its chip. */
  function acceptGuess(guessed: Extract<Said, { kind: 'guess' }>) {
    const result = confirmGuess(graph, conversation, guessed.text, guessed.reading, locales);
    if (result.kind !== 'stepped') {
      setSaid({ kind: 'refused' });
      return;
    }
    take(result.conversation, {
      kind: 'read',
      text: guessed.text,
      answers: result.readings.map(answerOf),
      unused: [],
      from: step,
      atStep: result.conversation.log.length,
    });
  }

  /** "Did you mean …?" — no: this question's own answers, to pick from, as for any miss. */
  function rejectGuess(guessed: Extract<Said, { kind: 'guess' }>) {
    setSaid({
      kind: 'ask',
      reason: 'nothing',
      options: askMenu(graph, node.id),
      elsewhere: [],
      text: guessed.text,
      listed: false,
    });
  }

  /** "change": the reading was wrong — undo it, however many steps, and put the words back. */
  function change(read: Extract<Said, { kind: 'read' }>) {
    setSaid(null);
    go(rewind(conversation, read.from), true, THE_BOX);
    setText(read.text);
  }

  /** "Remember", pressed: stored as shown, and what came of it said. */
  async function remember(offer: RememberAlias, label: string) {
    if (!learning) return;
    const at = step;
    const outcome = await learning.remember(offer);
    const note =
      outcome.kind === 'remembered'
        ? t('conversation.remember.done', { phrase: offer.phrase, option: label })
        : outcome.kind === 'failed'
          ? t('conversation.remember.failed')
          : outcome.reason === 'collision' && outcome.means
            ? t('conversation.remember.means', {
                phrase: offer.phrase,
                option: optionIn(offer.nodeId, outcome.means) ?? outcome.means,
              })
            : t('conversation.remember.known');
    setSaid({ kind: 'learned', note, atStep: at });
  }

  /** A gesture on the preview: a step in the log, but not a move — nothing slides or refocuses. */
  function editWith(ops: Op[]) {
    try {
      onChange(edit(conversation, ops, { locale: locales.contentLocale }));
    } catch (error) {
      if (!(error instanceof MachineError)) throw error;
      setSaid({ kind: 'refused' });
    }
  }

  /**
   * One of the answers offered for words the ladder could not read, pressed — and then, if it
   * could work, the offer to remember those words as a way to say it (T8). Nothing is stored
   * until "Remember" is pressed.
   */
  function pickReading(reading: Reading, words: string) {
    const result = choose(graph, conversation, toAnswer(graph, reading), locales, 'T8');
    if (result.kind === 'refused') {
      setSaid({ kind: 'refused' });
      return;
    }
    const offer = learning ? rememberOffer(graph, words, reading, locales, learning.aliases) : null;
    take(
      result.conversation,
      offer
        ? {
            kind: 'remember',
            offer,
            label: answerOf(reading),
            atStep: result.conversation.log.length,
          }
        : null,
    );
  }

  // A new node: focus its first answer, or the one chosen before on Back — where there are no
  // answer cards, Continue, else the text box; and a notice from the ladder belongs to the
  // question it was about.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const answers = body.querySelectorAll<HTMLElement>('[data-answer]');
    const asked = waiting ? t('conversation.reconcile.ask') : t(node.ask);
    const wanted =
      moved.focus === THE_BOX
        ? boxRef.current
        : moved.focus
          ? body.querySelector<HTMLElement>(`[data-answer-id="${CSS.escape(moved.focus)}"]`)
          : null;
    const first =
      wanted ??
      answers[0] ??
      // Before any box: a preview moment's preview is a real control, and not the answer.
      body.querySelector<HTMLElement>('[data-continue]') ??
      body.querySelector<HTMLElement>('input, textarea') ??
      body.querySelector<HTMLElement>('button');
    first?.focus();
    // What the last step said stays with the screen it led to, and no longer.
    setSaid((current) =>
      current &&
      (current.kind === 'read' || current.kind === 'remember' || current.kind === 'learned') &&
      current.atStep === step
        ? current
        : null,
    );
    setAnnouncement(
      answers.length > 0
        ? `${asked} ${t('conversation.answers', { count: answers.length })}`
        : asked,
    );
    // Only on arriving somewhere: a move, or a question to reconcile coming or going.
  }, [node.id, position, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Use these colours?" takes focus when it is asked, and again after a save that failed (the
  // button was disabled while it saved), so Enter answers it and Back cancels it.
  useEffect(() => {
    if (said?.kind === 'colours' && said.state !== 'saving') confirmColoursRef.current?.focus();
  }, [said]);

  // The keys, on the whole window, so they work wherever focus is.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const box =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
      const answers = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-answer]') ?? [])];
      const key = event.altKey ? (digitOfCode(event.code) ?? event.key) : event.key;
      const action = keyAction(
        {
          key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
        {
          typing: box !== null || target?.isContentEditable === true,
          boxEmpty: box ? box.value === '' : true,
          desktop,
          answers: answers.length,
        },
      );
      if (!action) return;
      event.preventDefault();
      if (action.kind === 'pick') answers[action.index]?.click();
      else if (action.kind === 'back') goBack();
      else if (action.kind === 'help') setHelp((open) => !open);
      else if (action.kind === 'edit') {
        if (spec) setEditing((open) => !open);
      } else {
        const at = answers.indexOf(document.activeElement as HTMLElement);
        const next = at === -1 ? 0 : (at + action.by + answers.length) % answers.length;
        answers[next]?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const out = wayOut(graph, conversation);
  const spec = waiting ? null : previewOf(graph, conversation, showMe);
  const preview = spec ? (
    <PreviewMoment
      spec={spec}
      graph={graph}
      conversation={conversation}
      contentLocales={contentLocales}
      contentLocale={locales.contentLocale}
      brand={brand}
      editing={editing}
      onEditing={setEditing}
      onEdit={editWith}
      onUseGuided={(fieldId) => onChange(takeGuided(conversation, fieldId))}
      onBackTo={(to) => {
        setSaid(null);
        go(backTo(conversation, to), true, choiceAt(conversation, to));
      }}
    />
  ) : null;
  const slide = reduced ? '' : moved.back ? ' conversation__node--back' : ' conversation__node--on';

  return (
    <div className="conversation">
      <Trail
        graph={graph}
        conversation={conversation}
        onBackTo={(to) => {
          setSaid(null);
          go(backTo(conversation, to), true, choiceAt(conversation, to));
        }}
      />

      <div key={`${position}:${node.id}`} className={`conversation__node${slide}`}>
        <div className="conversation__ask">
          <h1 id="conversation-question" className="conversation__question">
            {waiting ? t('conversation.reconcile.ask') : t(node.ask)}
          </h1>
          <button
            type="button"
            className="conversation__help-toggle"
            aria-expanded={help}
            aria-controls="conversation-help"
            aria-label={t('conversation.help')}
            onClick={() => setHelp((open) => !open)}
          >
            ?
          </button>
        </div>
        {help && (
          <p id="conversation-help" className="conversation__help">
            {waiting ? t('conversation.reconcile.help') : t(node.help)}
          </p>
        )}

        <div ref={bodyRef} className="conversation__body">
          {waiting ? (
            <Reconcile
              conversation={conversation}
              fieldId={waiting}
              contentLocales={contentLocales}
              contentLocale={locales.contentLocale}
              onKeepMine={() => onChange(keepMine(conversation, waiting))}
              onUseGuided={() => onChange(takeGuided(conversation, waiting))}
            />
          ) : (
            <NodeView
              graph={graph}
              node={node}
              conversation={conversation}
              locales={contentLocales}
              contentLocale={locales.contentLocale}
              onAnswer={answer}
              onOpenEditor={onOpenEditor}
              preview={node.kind === 'preview-moment' ? preview : undefined}
            />
          )}
        </div>

        {node.kind !== 'preview-moment' && preview}

        {said?.kind === 'read' && said.atStep === step && (
          <p className="conversation__reading">
            {t('conversation.readAs', { option: said.answers.join(' · ') })}
            <button type="button" className="button button--bare" onClick={() => change(said)}>
              {t('conversation.change')}
            </button>
          </p>
        )}
        {said?.kind === 'read' && said.atStep === step && said.unused.length > 0 && (
          <p className="small muted conversation__left-over">
            {t('conversation.unused')}{' '}
            {said.unused.map((unused, i) => (
              // Each in the language's own quotation marks, which `<q>` draws.
              <span key={i}>
                {i > 0 && ' '}
                <q>{unused.text}</q>
              </span>
            ))}
          </p>
        )}

        {said?.kind === 'remember' && said.atStep === step && (
          <div className="conversation__notice" role="status">
            <p>
              {t('conversation.remember.ask', { phrase: said.offer.phrase, option: said.label })}
            </p>
            <div className="conversation__maybe">
              <button
                type="button"
                className="button"
                onClick={() => void remember(said.offer, said.label)}
              >
                {t('conversation.remember.yes')}
              </button>
              <button type="button" className="button button--quiet" onClick={() => setSaid(null)}>
                {t('conversation.remember.no')}
              </button>
            </div>
          </div>
        )}

        {said?.kind === 'learned' && said.atStep === step && (
          <p className="conversation__reading" role="status">
            {said.note}
          </p>
        )}

        {said?.kind === 'colours' && (
          <div className="conversation__notice" role="status">
            <p>{t('conversation.colours.ask')}</p>
            {said.state === 'failed' && <p className="small">{t('conversation.colours.failed')}</p>}
            <div className="conversation__maybe">
              <button
                ref={confirmColoursRef}
                type="button"
                className="button"
                disabled={said.state === 'saving'}
                onClick={() => void applyColours(said)}
              >
                {t('conversation.colours.yes')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={said.state === 'saving'}
                onClick={() => setSaid(null)}
              >
                {t('conversation.colours.no')}
              </button>
            </div>
          </div>
        )}
        {said?.kind === 'coloursRefused' && (
          <p className="conversation__reading" role="status">
            {t('guided.skip.brandByAdministrator')}
          </p>
        )}

        {!waiting && readsFreeText(node) && (
          <form
            className="conversation__type"
            onSubmit={(event) => {
              event.preventDefault();
              readTyped();
            }}
          >
            {/* A text area, so a pasted list keeps its lines (T6); Enter sends, Shift+Enter is a
                new line, as in a chat. */}
            <textarea
              ref={boxRef}
              className="conversation__input"
              rows={1}
              value={text}
              placeholder={t('conversation.orType')}
              aria-label={t('conversation.orType')}
              maxLength={MAX_LIST}
              onChange={(event) => {
                setText(event.target.value);
                // Typing again is a new answer: what the last one said, or was held for, is gone.
                if (
                  said?.kind === 'ask' ||
                  said?.kind === 'refused' ||
                  said?.kind === 'guess' ||
                  said?.kind === 'coloursRefused' ||
                  (said?.kind === 'colours' && said.state !== 'saving')
                ) {
                  setSaid(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  readTyped();
                }
              }}
            />
            <button
              type="submit"
              className="conversation__send"
              aria-label={t('conversation.send')}
              disabled={text.trim() === ''}
            >
              <Icon name="arrow-right" />
            </button>
          </form>
        )}

        {said?.kind === 'guess' && (
          <div className="conversation__notice" role="status">
            <p>
              {t('conversation.guess.ask', {
                question: questionOf(said.reading.nodeId),
                answer: answerOf(said.reading),
              })}
            </p>
            <div className="conversation__maybe">
              <button type="button" className="button" onClick={() => acceptGuess(said)}>
                {t('conversation.guess.yes')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => rejectGuess(said)}
              >
                {t('conversation.guess.no')}
              </button>
            </div>
          </div>
        )}

        {(said?.kind === 'ask' || said?.kind === 'refused') && (
          <div className="conversation__notice" role="status">
            <p>{t(said.kind === 'ask' ? ASK[said.reason] : 'conversation.refused')}</p>
            {said.kind === 'ask' && said.options.length > 0 && (
              <div className="conversation__maybe">
                {said.options.map((option) => (
                  <button
                    key={`${option.optionId}:${String(option.value)}`}
                    type="button"
                    className="button button--quiet"
                    onClick={() => pickReading(option, said.text)}
                  >
                    {labelOf(option.optionId, option.value)}
                  </button>
                ))}
              </div>
            )}
            {said.kind === 'ask' && said.elsewhere.length > 0 && (
              <>
                <p className="small">{t('conversation.elsewhere')}</p>
                <div className="conversation__maybe">
                  {said.elsewhere.map((other) => (
                    <button
                      key={other.nodeId}
                      type="button"
                      className="button button--quiet"
                      onClick={() => answer({ kind: 'jump', to: other.nodeId })}
                    >
                      {t(other.question)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {said.kind === 'ask' && said.listed && (
              <p className="small">{t('conversation.shoppingList')}</p>
            )}
          </div>
        )}
      </div>

      <div className="conversation__foot">
        <button
          type="button"
          className="button button--quiet"
          onClick={goBack}
          disabled={step === 0}
        >
          <Icon name="arrow-left" />
          {t('conversation.back')}
        </button>
        {out.length > 0 && (
          <button
            type="button"
            className="button button--bare"
            aria-expanded={wayOutOpen}
            aria-controls="conversation-way-out"
            onClick={() => setWayOutOpen((open) => !open)}
          >
            {t('conversation.wayOut')}
          </button>
        )}
        {/* "Show me" where the graph shows nothing: a preview is already on a preview's screen. */}
        {conversation.state.focus !== null &&
          !waiting &&
          previewOf(graph, conversation) === null && (
            <button
              type="button"
              className="button button--bare"
              aria-pressed={showMe}
              onClick={() => setShowMe((on) => !on)}
            >
              {t('conversation.showMe')}
            </button>
          )}
        <button type="button" className="button button--bare" onClick={onOpenEditor}>
          {t('wizard.advanced')}
        </button>
        <span className="conversation__status">{status}</span>
      </div>

      {wayOutOpen && (
        <ul id="conversation-way-out" className="conversation__way-out">
          {out.map((target) => (
            <li key={target.nodeId}>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => answer({ kind: 'jump', to: target.nodeId })}
              >
                {t(target.question)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The question, then how many answers — announced once per node. */}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
