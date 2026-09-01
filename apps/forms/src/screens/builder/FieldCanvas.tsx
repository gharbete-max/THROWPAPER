import { useState, type ReactNode } from 'react';
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { pickText } from '@tp/i18n';
import type { Field } from '@tp/shared/forms';
import { cn } from '@tp/ui';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { hasLabel } from './field-defaults.js';

interface Props {
  fields: Field[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (fields: Field[]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  /** Rendered inside the open field's own row. */
  renderEditor: (field: Field) => ReactNode;
}

export function FieldCanvas({
  fields,
  selectedId,
  onSelect,
  onReorder,
  onRemove,
  onMove,
  onDuplicate,
  renderEditor,
}: Props) {
  const t = useT();
  // Keyboard sensor included deliberately: drag-and-drop that only works with a mouse is not
  // an accessible way to build a form.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((field) => field.id === active.id);
    const to = fields.findIndex((field) => field.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(fields, from, to));
  }

  if (fields.length === 0) {
    return <p className="muted builder__empty">{t('builder.empty')}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={fields.map((field) => field.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="builder__list">
          {fields.map((field, index) => (
            <SortableField
              key={field.id}
              field={field}
              selected={field.id === selectedId}
              first={index === 0}
              last={index === fields.length - 1}
              onSelect={onSelect}
              onRemove={onRemove}
              onMove={onMove}
              onDuplicate={onDuplicate}
              renderEditor={renderEditor}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableField({
  field,
  selected,
  first,
  last,
  onSelect,
  onRemove,
  onMove,
  onDuplicate,
  renderEditor,
}: {
  field: Field;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  renderEditor: (field: Field) => ReactNode;
}) {
  const t = useT();
  const { locale, locales } = useSession();
  const [confirming, setConfirming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  const label = hasLabel(field) ? pickText(locales, field.label, locale) : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'builder__item',
        selected && 'builder__item--selected',
        isDragging && 'builder__item--dragging',
      )}
    >
      <div className="builder__itemRow">
        <button
          type="button"
          className="builder__grip"
          aria-label={field.key}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>

        <button type="button" className="builder__itemBody" onClick={() => onSelect(field.id)}>
          <span className="small muted">{t(`fieldType.${field.type}`)}</span>
          <span className="builder__itemLabel">
            {field.type === 'page_break' ? (
              '— — —'
            ) : label?.value ? (
              label.value
            ) : (
              /*
               * An unlabelled question is the most common half-finished state and the builder used
               * to disguise it by showing the machine key, which looks like a name. Saying so here
               * means it is visible while scanning the list rather than at publish time.
               */
              <span className="status-warning">{t('builder.needsLabel')}</span>
            )}
            {'required' in field && field.required && (
              <span className="builder__required" title={t('field.required')}>
                *
              </span>
            )}
            {label?.fallback && label.value && (
              <span className="badge badge--warning">{label.locale}</span>
            )}
          </span>
        </button>

        {/*
        Up and down beside the drag handle. Dragging is fine with a mouse and awkward on a phone,
        which is where half of this will be used — and two buttons are something you can hit
        without a steady hand.
      */}
        <div className="builder__move">
          <button
            type="button"
            className="button button--quiet small"
            disabled={first}
            aria-label={t('builder.moveUp')}
            onClick={() => onMove(field.id, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="button button--quiet small"
            disabled={last}
            aria-label={t('builder.moveDown')}
            onClick={() => onMove(field.id, 1)}
          >
            ↓
          </button>
        </div>

        {/*
        Confirmed in place rather than in a dialog. Removing a field is frequent and small, and a
        modal for each one would be exhausting — but it is still a delete, so it still takes two
        deliberate clicks. The second click is a different button in a different colour, so it
        cannot be reached by double-clicking the first.
      */}
        <button
          type="button"
          className="button button--quiet small"
          onClick={() => onDuplicate(field.id)}
        >
          {t('builder.duplicate')}
        </button>

        {confirming ? (
          <div className="row builder__confirm">
            <button
              type="button"
              className="button button--danger small"
              onClick={() => onRemove(field.id)}
            >
              {t('builder.removeYes')}
            </button>
            <button
              type="button"
              className="button button--quiet small"
              autoFocus
              onClick={() => setConfirming(false)}
            >
              {t('confirm.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button button--quiet small"
            onClick={() => setConfirming(true)}
          >
            {t('builder.remove')}
          </button>
        )}
      </div>

      {/*
        The editor opens **inside the field's own row**, not in a panel somewhere else on the page.
        A side panel means the thing you are changing and the controls that change it are far
        apart — and on a narrow screen the panel sits below the whole list, so editing the second
        of twenty questions meant scrolling past the other eighteen to reach its settings.
      */}
      {selected && <div className="builder__editor">{renderEditor(field)}</div>}
    </li>
  );
}
