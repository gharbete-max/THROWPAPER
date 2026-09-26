import { useState } from 'react';
import type { LocaleConfig } from '@tp/i18n';
import {
  optionsOf,
  type Answer,
  type BuilderGraph,
  type Conversation,
  type MessageKey,
  type Node,
} from '@tp/shared/builder';
import type { FormDefinition } from '@tp/shared/forms';
import { Icon, type IconName } from '../../../components/Icon.js';
import { useT } from '../../../lib/i18n.js';
import { FormPreview } from '../FormPreview.js';
import { focusedField } from './conversation.js';

/**
 * One node's answers — `DESIGN-LANGUAGE.md`, "One decision per screen". Each kind renders its
 * answers and reports what was chosen; none of them decides what comes next. Every answer a key
 * can pick carries `data-answer` in order, so 1–9 and the arrows reach it (`keyboard.ts`), and
 * `data-answer-id` so focus can return to it after Back.
 */

export interface NodeViewProps {
  readonly graph: BuilderGraph;
  readonly node: Node;
  readonly conversation: Conversation;
  readonly locales: LocaleConfig;
  readonly contentLocale: string;
  readonly onAnswer: (answer: Answer) => void;
  /** The end's "Open it in the editor". */
  readonly onOpenEditor: () => void;
}

export function NodeView(props: NodeViewProps) {
  const { node, onAnswer } = props;
  switch (node.kind) {
    case 'question':
    case 'pick-one':
      return (
        <Cards
          items={node.options.map((o) => ({
            id: o.id,
            label: o.label,
            ...(o.detail ? { detail: o.detail } : {}),
            ...(o.icon ? { icon: o.icon as IconName } : {}),
          }))}
          onPick={(optionId) => onAnswer({ kind: 'option', optionId })}
        />
      );
    case 'pick-many':
      return (
        <MultiCards node={node} onDone={(optionIds) => onAnswer({ kind: 'options', optionIds })} />
      );
    case 'quantity':
      return (
        <Quantity
          min={node.min}
          max={node.max}
          initial={node.default}
          onDone={(value) => onAnswer({ kind: 'quantity', value })}
        />
      );
    case 'text-entry':
      return (
        <TextEntry
          examples={node.examples}
          required={node.required}
          onDone={(value) => onAnswer({ kind: 'text', value })}
        />
      );
    case 'confirm-guess':
      return (
        <Cards
          items={[
            { id: 'right', label: 'guided.guess.right' },
            { id: 'sort-of', label: 'guided.guess.sortOf' },
            { id: 'no', label: 'guided.guess.no' },
          ]}
          onPick={(verdict) =>
            onAnswer({ kind: 'guess', verdict: verdict as 'right' | 'sort-of' | 'no' })
          }
        />
      );
    case 'preview-moment':
      return (
        <>
          <LivePreview
            conversation={props.conversation}
            locales={props.locales}
            contentLocale={props.contentLocale}
          />
          <Continue onContinue={() => onAnswer({ kind: 'continue' })} />
        </>
      );
    case 'review-queue':
      return <Continue onContinue={() => onAnswer({ kind: 'continue' })} />;
    case 'menu':
      return (
        <Cards
          items={node.entries.flatMap((id) => {
            const entry = props.graph.nodes.find((n) => n.id === id);
            return entry ? [{ id, label: entry.ask }] : [];
          })}
          onPick={(to) => onAnswer({ kind: 'jump', to })}
        />
      );
    case 'end':
      return <End {...props} />;
  }
}

interface CardItem {
  readonly id: string;
  readonly label: MessageKey;
  readonly detail?: MessageKey;
  readonly icon?: IconName;
}

/** Two to four large answers, each labelled by its consequence and numbered for 1–9. */
export function Cards({
  items,
  onPick,
}: {
  items: readonly CardItem[];
  onPick: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="conversation__answers">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className="conversation__card"
          data-answer={index}
          data-answer-id={item.id}
          onClick={() => onPick(item.id)}
        >
          {index < 9 && (
            <span className="conversation__key" aria-hidden="true">
              {index + 1}
            </span>
          )}
          {item.icon && <Icon name={item.icon} />}
          <span className="conversation__card-text">
            <strong>{t(item.label)}</strong>
            {item.detail && <span className="conversation__detail">{t(item.detail)}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Several answers at once: each toggles, and Done answers with all that are on. */
function MultiCards({
  node,
  onDone,
}: {
  node: Node;
  onDone: (optionIds: readonly string[]) => void;
}) {
  const t = useT();
  const options = optionsOf(node);
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <div className="conversation__answers">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className="conversation__card"
            aria-pressed={on.has(option.id)}
            data-answer={index}
            data-answer-id={option.id}
            onClick={() => {
              const next = new Set(on);
              if (next.has(option.id)) next.delete(option.id);
              else next.add(option.id);
              setOn(next);
            }}
          >
            {index < 9 && (
              <span className="conversation__key" aria-hidden="true">
                {index + 1}
              </span>
            )}
            <span className="conversation__card-text">
              <strong>{t(option.label)}</strong>
            </span>
          </button>
        ))}
      </div>
      <div className="conversation__primary">
        <button
          type="button"
          className="button"
          onClick={() => onDone(options.filter((o) => on.has(o.id)).map((o) => o.id))}
        >
          {t('conversation.done')}
        </button>
      </div>
    </>
  );
}

/** A number, stepped: the number large, − and + beside it, Continue under it. */
export function Quantity({
  min,
  max,
  initial,
  onDone,
}: {
  min: number;
  max: number;
  initial: number;
  onDone: (value: number) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(Math.min(max, Math.max(min, initial)));
  return (
    <>
      <div className="conversation__stepper" role="group">
        <button
          type="button"
          className="conversation__step"
          aria-label={t('conversation.fewer')}
          disabled={value <= min}
          onClick={() => setValue(value - 1)}
        >
          <Icon name="minus" />
        </button>
        <output className="conversation__number" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="conversation__step"
          aria-label={t('conversation.more')}
          disabled={value >= max}
          onClick={() => setValue(value + 1)}
        >
          <Icon name="plus" />
        </button>
      </div>
      <Continue onContinue={() => onDone(value)} />
    </>
  );
}

/**
 * A text answer — the node's own box, not "Or type it": what is typed here *is* the answer, kept
 * verbatim. The example chips are labels, never wording to publish (ADR 0012, rule G13); pressing
 * one puts it in the box to edit.
 */
function TextEntry({
  examples,
  required,
  onDone,
}: {
  examples: readonly MessageKey[];
  required: boolean;
  onDone: (value: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const empty = value.trim() === '';
  return (
    <form
      className="conversation__text"
      onSubmit={(event) => {
        event.preventDefault();
        if (!(required && empty)) onDone(value);
      }}
    >
      <input
        className="conversation__input"
        value={value}
        aria-labelledby="conversation-question"
        onChange={(event) => setValue(event.target.value)}
      />
      {examples.length > 0 && (
        <div
          className="conversation__examples"
          role="group"
          aria-label={t('conversation.examples')}
        >
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className="conversation__chip"
              onClick={() => setValue(t(example))}
            >
              {t(example)}
            </button>
          ))}
        </div>
      )}
      <div className="conversation__primary">
        <button type="submit" className="button" disabled={required && empty}>
          {t('conversation.continue')}
        </button>
      </div>
    </form>
  );
}

function Continue({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  return (
    <div className="conversation__primary">
      <button type="button" className="button" data-continue onClick={onContinue}>
        {t('conversation.continue')}
      </button>
    </div>
  );
}

/**
 * The real control, drawn by the same `FieldInput` the public form uses (through
 * `FormPreview`): the question in focus when there is one, else the whole form. S5 adds the brand
 * kit, "Not completely happy with the preview? Click it to edit." and editing in place.
 */
export function LivePreview({
  conversation,
  locales,
  contentLocale,
}: {
  conversation: Conversation;
  locales: LocaleConfig;
  contentLocale: string;
}) {
  const field = focusedField(conversation);
  const { definition } = conversation.state.draft;
  const shown: FormDefinition = field ? { ...definition, fields: [field] } : definition;
  return (
    <div className="conversation__preview">
      <FormPreview definition={shown} locale={contentLocale} locales={locales} selectedId={null} />
    </div>
  );
}

/** The end: open the form in the editor to publish it, or keep going from the menu. */
function End({ graph, conversation, onAnswer, onOpenEditor }: NodeViewProps) {
  const t = useT();
  const menu = graph.nodes.find((n) => n.kind === 'menu');
  return (
    <div className="conversation__answers">
      <button
        type="button"
        className="conversation__card"
        data-answer={0}
        data-answer-id="editor"
        onClick={onOpenEditor}
      >
        <span className="conversation__key" aria-hidden="true">
          1
        </span>
        <Icon name="check" />
        <span className="conversation__card-text">
          <strong>{t('wizard.open')}</strong>
        </span>
      </button>
      {menu && conversation.state.cursor !== menu.id && (
        <button
          type="button"
          className="conversation__card"
          data-answer={1}
          data-answer-id={menu.id}
          onClick={() => onAnswer({ kind: 'jump', to: menu.id })}
        >
          <span className="conversation__key" aria-hidden="true">
            2
          </span>
          <Icon name="arrow-right" />
          <span className="conversation__card-text">
            <strong>{t('conversation.keepGoing')}</strong>
          </span>
        </button>
      )}
    </div>
  );
}
