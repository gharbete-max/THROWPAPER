import {
  CONDITION_OPERATORS,
  fieldSupports,
  VALUELESS_OPERATORS,
  type Condition,
  type Field,
  type VisibilityRule,
  type FormDefinition,
} from '@tp/shared/forms';
import { pickText } from '@tp/i18n';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { Icon } from '../../components/Icon.js';

const valueless = new Set<string>(VALUELESS_OPERATORS);

/**
 * "Show this only when…" — conditional logic.
 *
 * ## Only fields above this one
 *
 * The menu offers the questions that come **earlier** in the form, and nothing else. That is not a
 * simplification: it is what makes a cycle impossible. If A can only depend on something above it,
 * no chain of dependencies can close on itself, and the builder needs no cycle detector — a piece
 * of code that exists solely to catch a mistake, and which would have to say something at publish
 * time anyway.
 *
 * A form with no earlier questions says so rather than showing an empty dropdown, because an empty
 * dropdown looks like a bug and reads as one.
 */
export function FieldVisibility({
  field,
  definition,
  patch,
}: {
  field: Field;
  definition: FormDefinition;
  patch: (changes: Partial<Field>) => void;
}) {
  const t = useT();
  const { contentLocale: locale, locales } = useSession();

  // Asked of the schema, not of this object. Zod omits an unset optional, so a key-presence check
  // would answer "no conditions possible" for every field nobody had put a condition on yet.
  if (!fieldSupports(field.type, 'showWhen')) return null;

  const at = definition.fields.findIndex((candidate) => candidate.id === field.id);
  const earlier = definition.fields
    .slice(0, at === -1 ? 0 : at)
    // A page break has no answer to ask about, and a section break has none either.
    .filter((candidate) => 'label' in candidate && candidate.type !== 'section_break');

  // Read through a cast for the same reason the check is schema-driven: `fieldSupports` is a
  // boolean rather than a type guard, so it cannot narrow the union the way `in` does.
  const rule = (field as { showWhen?: VisibilityRule }).showWhen;
  const conditions: Condition[] = rule?.conditions ?? [];

  function setConditions(next: Condition[]) {
    // Removing the last condition removes the rule, rather than leaving `{conditions: []}` behind
    // — the schema requires at least one, and "always shown" is the absence of a rule.
    patch({
      showWhen: next.length === 0 ? undefined : { match: rule?.match ?? 'all', conditions: next },
    } as Partial<Field>);
  }

  const nameOf = (key: string) => {
    const found = earlier.find((candidate) => candidate.key === key);
    if (!found || !('label' in found)) return key;
    return pickText(locales, found.label, locale).value || key;
  };

  return (
    <details className="builder__advanced" open={conditions.length > 0}>
      <summary className="small muted">
        {t('visibility.heading')}
        {conditions.length > 0 && (
          <span className="badge badge--rule">
            {t('visibility.count', { n: conditions.length })}
          </span>
        )}
      </summary>

      <div className="stack">
        {earlier.length === 0 ? (
          <p className="small muted">{t('visibility.needsEarlierField')}</p>
        ) : (
          <>
            <p className="small muted">{t('visibility.intro')}</p>

            {conditions.length > 1 && (
              <label className="field">
                <span>{t('visibility.match')}</span>
                <select
                  value={rule?.match ?? 'all'}
                  onChange={(event) =>
                    patch({
                      showWhen: {
                        match: event.target.value as 'all' | 'any',
                        conditions,
                      },
                    } as Partial<Field>)
                  }
                >
                  <option value="all">{t('visibility.match.all')}</option>
                  <option value="any">{t('visibility.match.any')}</option>
                </select>
              </label>
            )}

            {conditions.map((condition, index) => (
              <div className="stack stack--tight builder__condition" key={index}>
                <label className="field">
                  <span className="small muted">{t('visibility.field')}</span>
                  <select
                    value={condition.fieldKey}
                    onChange={(event) =>
                      setConditions(
                        conditions.map((entry, at2) =>
                          at2 === index ? { ...entry, fieldKey: event.target.value } : entry,
                        ),
                      )
                    }
                  >
                    {/* A key that is no longer above this field still needs to be selectable, or
                        the dropdown would silently re-point the condition at something else. */}
                    {!earlier.some((candidate) => candidate.key === condition.fieldKey) && (
                      <option value={condition.fieldKey}>
                        {t('visibility.missingField', { key: condition.fieldKey })}
                      </option>
                    )}
                    {earlier.map((candidate) => (
                      <option key={candidate.id} value={candidate.key}>
                        {nameOf(candidate.key)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="row">
                  <label className="field">
                    <span className="small muted">{t('visibility.operator')}</span>
                    <select
                      value={condition.operator}
                      onChange={(event) =>
                        setConditions(
                          conditions.map((entry, at2) =>
                            at2 === index
                              ? { ...entry, operator: event.target.value as Condition['operator'] }
                              : entry,
                          ),
                        )
                      }
                    >
                      {CONDITION_OPERATORS.map((operator) => (
                        <option key={operator} value={operator}>
                          {t(`visibility.operator.${operator}`)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* "Answered" and "Empty" compare against nothing, so there is no box. */}
                  {!valueless.has(condition.operator) && (
                    <label className="field">
                      <span className="small muted">{t('visibility.value')}</span>
                      <input
                        value={condition.value}
                        onChange={(event) =>
                          setConditions(
                            conditions.map((entry, at2) =>
                              at2 === index ? { ...entry, value: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                </div>

                <button
                  type="button"
                  className="button button--quiet small"
                  onClick={() => setConditions(conditions.filter((_, at2) => at2 !== index))}
                >
                  <Icon name="trash" className="icon--lead" />
                  {t('visibility.remove')}
                </button>
              </div>
            ))}

            <button
              type="button"
              className="button button--quiet small"
              onClick={() =>
                setConditions([
                  ...conditions,
                  // Seeded with the nearest question above, which is the one people mean far more
                  // often than the first question in the form.
                  {
                    fieldKey: earlier[earlier.length - 1]?.key ?? '',
                    operator: 'equals',
                    value: '',
                  },
                ])
              }
            >
              <Icon name="plus" className="icon--lead" />
              {t('visibility.add')}
            </button>
          </>
        )}
      </div>
    </details>
  );
}
