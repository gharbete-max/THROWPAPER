import type { ReactNode } from 'react';
import {
  answerableChildren,
  MAX_GROUP_ENTRIES,
  type EntryField,
  type Field,
  type RepeatingGroupField,
} from '@tp/shared/forms';
import { pickText } from '@tp/i18n';
import { useState } from 'react';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { LocalisedField } from './LocalisedField.js';
import { Icon } from '../../components/Icon.js';
import { ENTRY_PALETTE, newField } from './field-defaults.js';

/**
 * The properties only a repeating block has.
 *
 * The children are **not** edited here. They are ordinary fields, so they are selected on the
 * canvas and edited in the ordinary properties panel — which means a question inside a block gets
 * the same rules, the same conditional visibility and the same translation tab as one outside it.
 * A second, smaller editor for nested fields is a second editor to keep in step, and the one that
 * falls behind is always the one fewer people look at.
 *
 * What is here is the shape of the block itself: how many times it may repeat, what to call one
 * repetition, and whether each one is a person who is admitted in their own right.
 */
export function GroupProperties({
  field,
  patch,
  renderChildEditor,
}: {
  field: RepeatingGroupField;
  patch: (changes: Partial<Field>) => void;
  /**
   * The ordinary properties panel, for one child.
   *
   * A render prop rather than an import, because the panel that renders this component is the same
   * panel a child needs — and a module that imported the module importing it would work today and
   * break the first time either is loaded lazily, which is what this app does with its heavier
   * screens.
   */
  renderChildEditor: (child: EntryField, onChange: (updated: EntryField) => void) => ReactNode;
}) {
  const t = useT();
  const { contentLocale: locale, locales } = useSession();
  const [openChildId, setOpenChildId] = useState<string | null>(null);

  const setChildren = (fields: EntryField[]) => patch({ fields } as unknown as Partial<Field>);

  const addChild = (type: EntryField['type']) => {
    // Keys are unique **within** the block, not globally: `guests[].name` and a top-level `name`
    // are different questions and both are reasonable.
    const child = newField(
      type,
      field.fields.map((existing) => existing.key),
      locales.default,
    ) as EntryField;
    setChildren([...field.fields, child]);
    setOpenChildId(child.id);
  };

  const move = (index: number, by: number) => {
    const next = [...field.fields];
    const target = index + by;
    const moved = next[index];
    const displaced = next[target];
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    setChildren(next);
  };

  return (
    <div className="stack">
      <div className="stack">
        <span className="small muted">{t('field.fields')}</span>
        <p className="small muted">{t('field.fieldsHint')}</p>

        <ul className="builder__nested">
          {field.fields.map((child, index) => (
            <li className="builder__nested-item" key={child.id}>
              <button
                type="button"
                className="button button--quiet builder__nested-open"
                onClick={() => setOpenChildId(openChildId === child.id ? null : child.id)}
                aria-expanded={openChildId === child.id}
              >
                <Icon name={child.type} />
                <span>
                  {('label' in child ? pickText(locales, child.label, locale).value : '') ||
                    child.key}
                </span>
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t('builder.moveUp')}
              >
                <Icon name="arrow-up" />
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => move(index, 1)}
                disabled={index === field.fields.length - 1}
                aria-label={t('builder.moveDown')}
              >
                <Icon name="arrow-down" />
              </button>
              {/*
                The last child cannot be removed. `fields` requires at least one, so an empty block
                would not parse — and the failure would arrive at publish as a schema error rather
                than here, where somebody could act on it.
              */}
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setChildren(field.fields.filter((_unused, at) => at !== index))}
                disabled={field.fields.length <= 1}
                aria-label={t('builder.remove')}
              >
                <Icon name="trash" />
              </button>

              {/*
                The child's own panel, opened in place.
                A question inside a block gets the *same* editor as one outside it — the same rules,
                the same conditional visibility, the same translation tab — because it is the same
                component. The definition handed to it is the block's own field list, which is what
                makes a condition inside an entry offer only that entry's earlier questions.
              */}
              {openChildId === child.id && (
                <div className="builder__nested-editor">
                  {renderChildEditor(child, (updated) =>
                    setChildren(
                      field.fields.map((existing) =>
                        existing.id === updated.id ? updated : existing,
                      ),
                    ),
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="builder__nested-add">
          {ENTRY_PALETTE.map((type) => (
            <button
              type="button"
              className="button button--quiet"
              key={type}
              onClick={() => addChild(type)}
            >
              <Icon name={type} />
              <span>{t(`fieldType.${type}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>{t('field.minEntries')}</span>
        <input
          type="number"
          min={0}
          max={MAX_GROUP_ENTRIES}
          value={field.min}
          onChange={(event) =>
            patch({ min: clamp(event.target.value, 0) } as unknown as Partial<Field>)
          }
        />
      </label>

      <label className="field">
        <span>{t('field.maxEntries')}</span>
        <input
          type="number"
          min={1}
          max={MAX_GROUP_ENTRIES}
          value={field.max}
          onChange={(event) =>
            patch({ max: clamp(event.target.value, 1) } as unknown as Partial<Field>)
          }
        />
        <span className="small muted">{t('field.maxEntriesHint')}</span>
      </label>

      <LocalisedField
        label={t('field.addLabel')}
        value={field.addLabel}
        locale={locale}
        supported={locales.supported}
        onChange={(target, text) =>
          patch({ addLabel: { ...field.addLabel, [target]: text } } as unknown as Partial<Field>)
        }
      />

      <LocalisedField
        label={t('field.entryLabel')}
        value={field.entryLabel}
        locale={locale}
        supported={locales.supported}
        hint={t('field.entryLabelHint')}
        onChange={(target, text) =>
          patch({
            entryLabel: { ...field.entryLabel, [target]: text },
          } as unknown as Partial<Field>)
        }
      />

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={field.admits}
          onChange={(event) => patch({ admits: event.target.checked } as unknown as Partial<Field>)}
        />
        <span>{t('field.admits')}</span>
      </label>
      <p className="small muted">{t('field.admitsHint')}</p>

      {field.admits && (
        <label className="field">
          <span>{t('field.admitNameKey')}</span>
          {/*
            Chosen from the block's own questions rather than typed. A name key that matches
            nothing produces a card that says "—" for every guest, and the author would not find
            out until the cards were printed.
          */}
          <select
            value={field.admitNameKey ?? ''}
            onChange={(event) =>
              patch({
                admitNameKey: event.target.value || undefined,
              } as unknown as Partial<Field>)
            }
          >
            <option value="" />
            {answerableChildren(field).map((child) => (
              <option key={child.id} value={child.key}>
                {('label' in child ? pickText(locales, child.label, locale).value : '') ||
                  child.key}
              </option>
            ))}
          </select>
          <span className="small muted">{t('field.admitNameKeyHint')}</span>
        </label>
      )}
    </div>
  );
}

/** A count within the schema's bounds, so a cleared box does not write `NaN` into the definition. */
function clamp(raw: string, lowest: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return lowest;
  return Math.min(MAX_GROUP_ENTRIES, Math.max(lowest, Math.round(value)));
}
