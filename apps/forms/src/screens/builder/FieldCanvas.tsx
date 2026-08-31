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
}

export function FieldCanvas({ fields, selectedId, onSelect, onReorder, onRemove }: Props) {
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
          {fields.map((field) => (
            <SortableField
              key={field.id}
              field={field}
              selected={field.id === selectedId}
              onSelect={onSelect}
              onRemove={onRemove}
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
  onSelect,
  onRemove,
}: {
  field: Field;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const { locale, locales } = useSession();
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
          {field.type === 'page_break' ? '— — —' : (label?.value ?? field.key)}
          {label?.fallback && label.value && (
            <span className="badge badge--warning">{label.locale}</span>
          )}
        </span>
      </button>

      <button
        type="button"
        className="button button--quiet small"
        onClick={() => {
          if (window.confirm(t('builder.removeConfirm'))) onRemove(field.id);
        }}
      >
        {t('builder.remove')}
      </button>
    </li>
  );
}
