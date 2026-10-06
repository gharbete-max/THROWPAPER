import { useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Op } from '@tp/shared/builder';
import {
  CHOICE_ACCENTS,
  ChoiceStyle,
  LOGO_SLOTS,
  type Field,
  type LogoSlot,
} from '@tp/shared/forms';
import { Icon } from '../../../../components/Icon.js';
import { useT } from '../../../../lib/i18n.js';
import {
  accentOps,
  currentShape,
  editableChoice,
  moveOptionOps,
  renameOps,
  renameOptionOps,
  shapeOps,
  shapesFor,
  sizeOps,
  type InlineShape,
} from './inline-edit.js';

/**
 * Inline editing, under the preview it edits — `PREDICTIVE-BUILDER.md`, "The preview contract".
 * Every control snaps to what the schema allows (`inline-edit.ts`, `CAVEATS.md` #55), and every
 * change is a step in the conversation's log, undone by Back like an answer. A drag always has a
 * keyboard twin (#44): Move up and Move down beside each answer.
 */

const SLOT_LABELS: Record<LogoSlot, string> = {
  'header-left': 'guided.brand.logoSlot.headerLeft',
  'masthead-centred': 'guided.brand.logoSlot.mastheadCentred',
  'corner-watermark': 'guided.brand.logoSlot.cornerWatermark',
  'footer-strip': 'guided.brand.logoSlot.footerStrip',
  'sidebar-rail': 'guided.brand.logoSlot.sidebarRail',
  'card-top': 'guided.brand.logoSlot.cardTop',
};

const shapeLabel = (shape: InlineShape) =>
  shape === 'tile' ? 'guided.choice.shape.tile' : `field.shape.${shape}`;

export function InlineEdit({
  field,
  locale,
  onEdit,
  onDone,
}: {
  /** The question the preview shows. */
  field: Field;
  /** The language being written: renaming writes this one and leaves the others alone. */
  locale: string;
  onEdit: (ops: Op[]) => void;
  onDone: () => void;
}) {
  const t = useT();
  const apply = (ops: Op[] | null) => {
    if (ops) onEdit(ops);
  };
  const choice = editableChoice(field) ? field : null;
  const style = choice ? ChoiceStyle.parse(choice.style ?? {}) : null;
  const shape = choice ? currentShape(choice) : null;

  return (
    <div className="inline-edit" role="group" aria-label={t('conversation.edit.title')}>
      {'label' in field && (
        <Words
          label={t('conversation.edit.question')}
          value={field.label[locale] ?? ''}
          onCommit={(words) => apply(renameOps(field, locale, words))}
        />
      )}

      {choice && style && (
        <>
          <fieldset className="inline-edit__group">
            <legend>{t('field.shape')}</legend>
            <div className="inline-edit__row">
              {shapesFor(choice).map((each) => (
                <button
                  key={each}
                  type="button"
                  className="inline-edit__shape"
                  aria-pressed={shape === each}
                  onClick={() => apply(shapeOps(choice, each))}
                >
                  <span
                    className={`inline-edit__sample inline-edit__sample--${each}`}
                    aria-hidden="true"
                  />
                  {t(shapeLabel(each))}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="inline-edit__group">
            <legend>{t('field.size')}</legend>
            <div className="inline-edit__stepper">
              <button
                type="button"
                className="inline-edit__step"
                aria-label={t('conversation.edit.smaller')}
                disabled={sizeOps(choice, -1) === null}
                onClick={() => apply(sizeOps(choice, -1))}
              >
                <Icon name="minus" />
              </button>
              <output>{t(`field.size.${style.size}`)}</output>
              <button
                type="button"
                className="inline-edit__step"
                aria-label={t('conversation.edit.larger')}
                disabled={sizeOps(choice, 1) === null}
                onClick={() => apply(sizeOps(choice, 1))}
              >
                <Icon name="plus" />
              </button>
            </div>
          </fieldset>

          <fieldset className="inline-edit__group">
            <legend>{t('field.accent')}</legend>
            <div className="inline-edit__row">
              {CHOICE_ACCENTS.map((role) => (
                <button
                  key={role}
                  type="button"
                  className="inline-edit__swatch"
                  aria-pressed={style.accent === role}
                  onClick={() => apply(accentOps(choice, role))}
                >
                  <span
                    className={`inline-edit__chip inline-edit__chip--${role}`}
                    aria-hidden="true"
                  />
                  {t(`brand.colour.${role}`)}
                </button>
              ))}
            </div>
          </fieldset>

          {choice.type !== 'yes_no' && (
            <Answers
              options={choice.options}
              locale={locale}
              onRename={(value, words) => apply(renameOptionOps(choice, value, locale, words))}
              onMove={(value, to) => apply(moveOptionOps(choice, value, to))}
            />
          )}
        </>
      )}

      <div className="inline-edit__done">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('conversation.done')}
        </button>
      </div>
    </div>
  );
}

/** The six places for the logo, for a preview of the whole form. */
export function SlotEdit({
  slot,
  onPick,
  onDone,
}: {
  slot: LogoSlot | undefined;
  onPick: (slot: LogoSlot) => void;
  onDone: () => void;
}) {
  const t = useT();
  return (
    <div className="inline-edit" role="group" aria-label={t('conversation.edit.title')}>
      <fieldset className="inline-edit__group">
        <legend>{t('settings.logoSlot')}</legend>
        <div className="inline-edit__row">
          {LOGO_SLOTS.map((each) => (
            <button
              key={each}
              type="button"
              className="inline-edit__shape"
              aria-pressed={slot === each}
              onClick={() => onPick(each)}
            >
              {t(SLOT_LABELS[each])}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="inline-edit__done">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('conversation.done')}
        </button>
      </div>
    </div>
  );
}

/**
 * Words typed in place, written as one step when the box is left or Enter is pressed — not a
 * step per keystroke, which would make Back undo one letter at a time.
 */
function Words({
  label,
  value,
  onCommit,
  quiet = false,
}: {
  label: string;
  value: string;
  onCommit: (words: string) => void;
  /** The label is for a screen reader only: each answer's row says "Answer 2" to no one else. */
  quiet?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // A step elsewhere (Back, Use guided) changes the words under the box: show them.
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="field inline-edit__words">
      <span className={quiet ? 'visually-hidden' : undefined}>{label}</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommit(draft);
          }
        }}
      />
    </label>
  );
}

type Option = { readonly value: string; readonly label: Readonly<Record<string, string>> };

/** The answers: renamed in place, and moved by drag or by Move up / Move down. */
function Answers({
  options,
  locale,
  onRename,
  onMove,
}: {
  options: readonly Option[];
  locale: string;
  onRename: (value: string, words: string) => void;
  onMove: (value: string, to: number) => void;
}) {
  const t = useT();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const values = options.map((o) => o.value);

  function onDragEnd(event: DragEndEvent) {
    const to = values.indexOf(String(event.over?.id ?? ''));
    if (to >= 0 && event.active.id !== event.over?.id) onMove(String(event.active.id), to);
  }

  return (
    <fieldset className="inline-edit__group">
      <legend>{t('conversation.edit.options')}</legend>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={values} strategy={verticalListSortingStrategy}>
          <ol className="inline-edit__answers">
            {options.map((option, index) => (
              <AnswerRow
                key={option.value}
                option={option}
                locale={locale}
                n={index + 1}
                first={index === 0}
                last={index === options.length - 1}
                onRename={(words) => onRename(option.value, words)}
                onMove={(by) => onMove(option.value, index + by)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </fieldset>
  );
}

function AnswerRow({
  option,
  locale,
  n,
  first,
  last,
  onRename,
  onMove,
}: {
  option: Option;
  locale: string;
  n: number;
  first: boolean;
  last: boolean;
  onRename: (words: string) => void;
  onMove: (by: -1 | 1) => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: option.value,
  });
  return (
    <li
      ref={setNodeRef}
      className="inline-edit__answer"
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="inline-edit__grip"
        aria-label={t('conversation.edit.drag')}
        {...attributes}
        {...listeners}
      >
        <Icon name="drag" />
      </button>
      <Words
        label={t('conversation.edit.answer', { n })}
        value={option.label[locale] ?? ''}
        onCommit={onRename}
        quiet
      />
      <button
        type="button"
        className="inline-edit__step"
        aria-label={t('conversation.edit.moveUp')}
        disabled={first}
        onClick={() => onMove(-1)}
      >
        <Icon name="arrow-up" />
      </button>
      <button
        type="button"
        className="inline-edit__step"
        aria-label={t('conversation.edit.moveDown')}
        disabled={last}
        onClick={() => onMove(1)}
      >
        <Icon name="arrow-down" />
      </button>
    </li>
  );
}
