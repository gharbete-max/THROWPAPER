import { useEffect, useRef, useState } from 'react';
import type { LocaleConfig } from '@tp/i18n';
import {
  currentNode,
  optionsOf,
  type Answer,
  type BuilderGraph,
  type Conversation,
} from '@tp/shared/builder';
import { toAnswer, type AskReason, type Reading } from '@tp/shared/interpret';
import { Icon } from '../../../components/Icon.js';
import { useT } from '../../../lib/i18n.js';
import { useReducedMotion } from '../../../lib/motion.js';
import {
  backTo,
  choiceAt,
  choose,
  lastChoice,
  readsFreeText,
  showsPreview,
  stepBack,
  typed,
  wayOut,
  type Locales,
} from './conversation.js';
import { digitOfCode, keyAction } from './keyboard.js';
import { LivePreview, NodeView } from './NodeView.js';
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
}

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

/** What the ladder said about the last thing typed. */
type Said =
  | { readonly kind: 'ask'; readonly reason: AskReason; readonly options: readonly Reading[] }
  | { readonly kind: 'refused' }
  /** Applied: the transparency chip, until the next step. */
  | {
      readonly kind: 'read';
      readonly text: string;
      readonly option: string;
      readonly atStep: number;
    };

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
}: ShellProps) {
  const t = useT();
  const reduced = useReducedMotion();
  const node = currentNode(graph, conversation);
  const step = conversation.log.length;

  const [help, setHelp] = useState(false);
  const [wayOutOpen, setWayOutOpen] = useState(false);
  const [text, setText] = useState('');
  const [said, setSaid] = useState<Said | null>(null);
  /** Which way the last move went, for the slide; and what to focus when it lands. */
  const [moved, setMoved] = useState<{ back: boolean; focus: string | null }>({
    back: false,
    focus: null,
  });

  /** The live region's words: the question, then how many answers. */
  const [announcement, setAnnouncement] = useState('');

  /** The node's own answers, without the question's "?" or the preview's controls. */
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);

  /** The label an option id reads as, in the interface language. */
  const labelOf = (optionId: string | null, value: unknown): string => {
    const option = optionsOf(node).find((o) => o.id === optionId);
    return option ? t(option.label) : String(value ?? '');
  };

  function go(next: Conversation, back: boolean, focus: string | null = null) {
    setHelp(false);
    setWayOutOpen(false);
    setMoved({ back, focus });
    onChange(next);
  }

  function answer(given: Answer) {
    const result = choose(graph, conversation, given, locales);
    if (result.kind === 'refused') {
      setSaid({ kind: 'refused' });
      return;
    }
    setSaid(null);
    setText('');
    go(result.conversation, false);
  }

  function goBack() {
    if (step === 0) return;
    const focus = lastChoice(conversation);
    setSaid(null);
    go(stepBack(conversation), true, focus);
  }

  function readTyped() {
    if (text.trim() === '') return;
    const result = typed(graph, conversation, text, locales);
    if (result.kind === 'ask') {
      setSaid({ kind: 'ask', reason: result.reason, options: result.options });
      return;
    }
    if (result.kind === 'refused') {
      setSaid({ kind: 'refused' });
      return;
    }
    setSaid({
      kind: 'read',
      text,
      option: labelOf(result.reading.optionId, result.reading.value),
      atStep: step + 1,
    });
    setText('');
    go(result.conversation, false);
  }

  /** "change": the reading was wrong — undo it, and put the words back to edit. */
  function change(words: string) {
    setSaid(null);
    go(stepBack(conversation), true, THE_BOX);
    setText(words);
  }

  /** One of the answers the ladder could not choose between, pressed. */
  function pickReading(reading: Reading) {
    const result = choose(graph, conversation, toAnswer(graph, reading), locales);
    if (result.kind === 'refused') {
      setSaid({ kind: 'refused' });
      return;
    }
    setSaid(null);
    setText('');
    go(result.conversation, false);
  }

  // A new node: focus its first answer, or the one chosen before on Back — where there are no
  // answer cards, Continue, else the text box; and a notice from the ladder belongs to the
  // question it was about.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const answers = body.querySelectorAll<HTMLElement>('[data-answer]');
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
      body.querySelector<HTMLElement>('input') ??
      body.querySelector<HTMLElement>('button');
    first?.focus();
    setSaid((current) => (current?.kind === 'read' && current.atStep === step ? current : null));
    setAnnouncement(
      answers.length > 0
        ? `${t(node.ask)} ${t('conversation.answers', { count: answers.length })}`
        : t(node.ask),
    );
    // Only on arriving somewhere: `moved` is set with every move.
  }, [node.id, step]); // eslint-disable-line react-hooks/exhaustive-deps

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
      else {
        const at = answers.indexOf(document.activeElement as HTMLElement);
        const next = at === -1 ? 0 : (at + action.by + answers.length) % answers.length;
        answers[next]?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const out = wayOut(graph, conversation);
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

      <div key={`${step}:${node.id}`} className={`conversation__node${slide}`}>
        <div className="conversation__ask">
          <h1 id="conversation-question" className="conversation__question">
            {t(node.ask)}
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
            {t(node.help)}
          </p>
        )}

        <div ref={bodyRef} className="conversation__body">
          <NodeView
            graph={graph}
            node={node}
            conversation={conversation}
            locales={contentLocales}
            contentLocale={locales.contentLocale}
            onAnswer={answer}
            onOpenEditor={onOpenEditor}
          />
        </div>

        {showsPreview(graph, conversation) && node.kind !== 'preview-moment' && (
          <LivePreview
            conversation={conversation}
            locales={contentLocales}
            contentLocale={locales.contentLocale}
          />
        )}

        {said?.kind === 'read' && said.atStep === step && (
          <p className="conversation__reading">
            {t('conversation.readAs', { option: said.option })}
            <button type="button" className="button button--bare" onClick={() => change(said.text)}>
              {t('conversation.change')}
            </button>
          </p>
        )}

        {readsFreeText(node) && (
          <form
            className="conversation__type"
            onSubmit={(event) => {
              event.preventDefault();
              readTyped();
            }}
          >
            <input
              ref={boxRef}
              className="conversation__input"
              value={text}
              placeholder={t('conversation.orType')}
              aria-label={t('conversation.orType')}
              maxLength={500}
              onChange={(event) => {
                setText(event.target.value);
                if (said?.kind === 'ask' || said?.kind === 'refused') setSaid(null);
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
                    onClick={() => pickReading(option)}
                  >
                    {labelOf(option.optionId, option.value)}
                  </button>
                ))}
              </div>
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
