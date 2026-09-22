import { pickText, type LocaleConfig } from '@tp/i18n';
import {
  entryIssueKey,
  minEntries,
  type AnswerValue,
  type GroupEntry,
  type RepeatingGroupField,
} from '@tp/shared/forms';
import { FieldInput } from './FieldInput.js';

/**
 * A block of questions asked more than once — guests, readings, items inspected.
 *
 * Each entry renders the **same `FieldInput`** the rest of the form renders, so a question behaves
 * identically inside a group and outside one: the same validation messages, the same file upload,
 * the same signature pad. A second renderer for nested fields is a second renderer to keep in step,
 * and the one that falls behind is always the one fewer people look at.
 *
 * See `docs/adr/0003-repeating-groups.md`.
 */

/**
 * The catalogue strings a group needs, gathered once.
 *
 * Both the public form and the builder's preview render groups, and both would otherwise assemble
 * six `t(...)` calls apiece — two lists to keep in step, and the preview is the one that would
 * quietly fall behind.
 */
export function groupLabels(
  t: (key: string, vars?: Record<string, string | number>) => string,
  max: number,
): GroupLabels {
  return {
    add: t('group.add'),
    remove: t('group.remove'),
    removeEntry: (entry) => t('group.removeEntry', { entry }),
    entryHeading: (label, number) => t('group.entryHeading', { label, number }),
    empty: t('group.empty'),
    full: t('group.full', { max }),
  };
}

export interface GroupLabels {
  /** The button. Falls back to this when the author wrote no `addLabel`. */
  add: string;
  remove: string;
  /** Accessible name for the remove button, which needs to say *which* entry it removes. */
  removeEntry: (entry: string) => string;
  /** The heading above one entry — "Guest 1". */
  entryHeading: (label: string, number: number) => string;
  /** What a group with nothing in it says, so an empty block is not a mystery. */
  empty: string;
  /** Shown in place of the add button once the cap is reached, saying what the cap is. */
  full: string;
}

/**
 * What is on screen: whatever has been answered, padded up to the minimum.
 *
 * Padded rather than written into state by an effect on mount. A block with `min: 2` should show
 * two entries the moment the page renders; an effect that fills them in afterwards is a frame of
 * empty block followed by a jump, and one more thing that can run twice.
 *
 * A copy either way, so the caller's array is never the one being edited.
 */
export function entriesShown(entries: readonly GroupEntry[], min: number): GroupEntry[] {
  if (entries.length >= min) return [...entries];
  return [...entries, ...Array.from({ length: min - entries.length }, () => ({}))];
}

export function RepeatingGroup({
  field,
  locale,
  locales,
  entries,
  labels,
  chooseLabel,
  yesLabel,
  noLabel,
  issueFor,
  onChange,
  slug,
}: {
  field: RepeatingGroupField;
  locale: string;
  locales: LocaleConfig;
  entries: readonly GroupEntry[];
  labels: GroupLabels;
  chooseLabel: string;
  yesLabel: string;
  noLabel: string;
  /** Looks an issue up by its full path — `guests[0].name`. */
  issueFor: (key: string) => string | null;
  onChange: (key: string, value: AnswerValue) => void;
  slug?: string;
}) {
  const text = (source: Record<string, string> | undefined) =>
    source ? pickText(locales, source, locale).value : '';

  const min = minEntries(field);
  const shown = entriesShown(entries, min);

  const entryName = text(field.entryLabel) || text(field.label);
  const canAdd = shown.length < field.max;
  const canRemove = shown.length > min;

  const write = (next: GroupEntry[]) => onChange(field.key, next);

  return (
    <div className="stack repeating-group">
      <div className="stack repeating-group__intro">
        <h2 className="repeating-group__title">{text(field.label)}</h2>
        {field.helpText && <p className="muted small">{text(field.helpText)}</p>}
      </div>

      {shown.length === 0 && <p className="muted small">{labels.empty}</p>}

      {shown.map((entry, index) => (
        /*
         * A fieldset per entry, because that is what one is: a group of controls with a shared
         * name. A screen reader then announces "Guest 2" before each question inside it, which is
         * the difference between six inputs called "Name" and six that say whose.
         *
         * Keyed by position rather than by anything in the answers. An entry has no identity of
         * its own until it is submitted — see the ADR — and keying on a name would remount every
         * box below the one somebody is typing into.
         */
        <fieldset className="repeating-group__entry" key={index}>
          <legend className="repeating-group__legend">
            {labels.entryHeading(entryName, index + 1)}
          </legend>

          <div className="form-grid">
            {field.fields.map((child) => (
              <div
                className={`form-grid__cell form-grid__cell--${'width' in child ? child.width : 'full'}`}
                key={child.id}
              >
                <FieldInput
                  field={child}
                  slug={slug}
                  locale={locale}
                  locales={locales}
                  value={entry[child.key]}
                  error={issueFor(entryIssueKey(field.key, index, child.key))}
                  chooseLabel={chooseLabel}
                  yesLabel={yesLabel}
                  noLabel={noLabel}
                  onChange={(key, value) =>
                    write(
                      shown.map((current, at) =>
                        at === index ? { ...current, [key]: value as GroupEntry[string] } : current,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>

          {canRemove && (
            <button
              type="button"
              className="button button--quiet repeating-group__remove"
              onClick={() => write(shown.filter((_unused, at) => at !== index))}
              aria-label={labels.removeEntry(labels.entryHeading(entryName, index + 1))}
            >
              {labels.remove}
            </button>
          )}
        </fieldset>
      ))}

      {canAdd ? (
        <button
          type="button"
          className="button button--quiet repeating-group__add"
          onClick={() => write([...shown, {}])}
        >
          {text(field.addLabel) || labels.add}
        </button>
      ) : (
        /*
         * The cap is said out loud rather than shown as a button that does nothing. A disabled
         * control with no explanation is the version of this people press repeatedly.
         */
        <p className="muted small">{labels.full}</p>
      )}
    </div>
  );
}
