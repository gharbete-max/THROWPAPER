import { useState } from 'react';
import type { Field } from '@tp/shared/forms';
import { useT } from '../../lib/i18n.js';

/**
 * What counts as a valid answer.
 *
 * The validator in `packages/shared` has enforced length limits, patterns, number ranges, decimal
 * places and selection counts since it was written. The builder offered a control for none of
 * them, so every one of those rules was dead: reachable by an API client, invisible to the person
 * actually writing the form. This is the panel that reaches them.
 *
 * Grouped behind a summary rather than laid out inline. Most fields want none of this, and a
 * properties panel that opens with six empty numeric boxes reads as a database screen — which is
 * the exact complaint the key field was folded away for.
 */
export function FieldRules({
  field,
  patch,
}: {
  field: Field;
  patch: (changes: Partial<Field>) => void;
}) {
  const t = useT();
  const controls = rulesFor(field);
  if (controls.length === 0) return null;

  return (
    <details className="builder__advanced">
      <summary className="small muted">{t('rules.heading')}</summary>
      <div className="stack">
        <p className="small muted">{t('rules.intro')}</p>
        {controls.map((control) => (
          /**
           * Keyed by field **and** control.
           *
           * Keyed by control alone, React would reuse the same component instance when you click
           * from one short text field to another — and `PatternRule`'s "I am writing my own
           * expression" state would come with it, showing an expression box on a field that has
           * no pattern at all. The id in the key makes selecting a different field a remount.
           */
          <RuleControl
            key={`${field.id}:${control}`}
            control={control}
            field={field}
            patch={patch}
          />
        ))}
      </div>
    </details>
  );
}

/**
 * Rule names shown for each field type.
 *
 * Derived from what the schema actually allows on that variant, so this list and
 * `fieldProperties()` cannot drift — `field-properties.test.ts` compares them.
 */
type RuleName =
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'rows'
  | 'min'
  | 'max'
  | 'decimals'
  | 'minSelected'
  | 'maxSelected'
  | 'defaultValue';

export function rulesFor(field: Field): RuleName[] {
  switch (field.type) {
    case 'short_text':
    case 'phone':
      return ['minLength', 'maxLength', 'pattern'];
    case 'long_text':
      return ['minLength', 'maxLength', 'pattern', 'rows'];
    case 'number':
      return ['min', 'max', 'decimals'];
    case 'date':
    case 'time':
      return ['min', 'max'];
    case 'multi_select':
      return ['minSelected', 'maxSelected'];
    case 'hidden':
      return ['defaultValue'];
    default:
      return [];
  }
}

/**
 * Ready-made patterns, because almost nobody writing a form writes a regular expression.
 *
 * Anchoring is the validator's job (`safeMatch` wraps these in `^(?:…)$`), so these are fragments
 * and must not carry their own anchors — doubling them would reject everything.
 */
const PATTERN_PRESETS: Record<string, string> = {
  letters: '[\\p{L} .\\-]+',
  digits: '[0-9]+',
  alphanumeric: '[\\p{L}0-9]+',
  postcodeSe: '[0-9]{3} ?[0-9]{2}',
  url: 'https?://\\S+',
};

function RuleControl({
  control,
  field,
  patch,
}: {
  control: RuleName;
  field: Field;
  patch: (changes: Partial<Field>) => void;
}) {
  const t = useT();
  const current = (field as unknown as Record<string, unknown>)[control];

  if (control === 'pattern') return <PatternRule field={field} patch={patch} />;

  if (control === 'defaultValue') {
    return (
      <label className="field">
        <span>{t('rules.defaultValue')}</span>
        <input
          value={typeof current === 'string' ? current : ''}
          onChange={(event) =>
            patch({ defaultValue: event.target.value || undefined } as Partial<Field>)
          }
        />
        <span className="small muted">{t('rules.defaultValueHint')}</span>
      </label>
    );
  }

  /**
   * `min` and `max` mean three different things depending on the field.
   *
   * A number's bounds are numbers; a date's are dates; a time's are times. One numeric control for
   * all three would have written `Number('09:00')` — `NaN` — into a date or time field, which Zod
   * then rejects at publish with no clue where it came from.
   */
  if (control === 'min' || control === 'max') {
    const asDate = field.type === 'date';
    const asTime = field.type === 'time';
    if (asDate || asTime) {
      return (
        <label className="field">
          <span>{t(`rules.${control}${asDate ? 'Date' : 'Time'}`)}</span>
          <input
            type={asDate ? 'date' : 'time'}
            value={typeof current === 'string' ? current : ''}
            onChange={(event) =>
              patch({ [control]: event.target.value || undefined } as Partial<Field>)
            }
          />
        </label>
      );
    }
  }

  return (
    <label className="field">
      <span>{t(`rules.${control}`)}</span>
      <input
        type="number"
        {...NUMERIC_BOUNDS[control]}
        value={typeof current === 'number' ? String(current) : ''}
        onChange={(event) => {
          /**
           * An empty box means "no rule", not nought.
           *
           * `Number('')` is `0`, so reading the box directly would turn clearing a maximum into
           * a maximum of zero — a field nobody could ever fill in, with no visible cause.
           */
          const raw = event.target.value;
          patch({ [control]: raw === '' ? undefined : Number(raw) } as Partial<Field>);
        }}
      />
    </label>
  );
}

/**
 * The format rule: a menu of ready-made patterns, with the expression itself behind "Custom".
 *
 * Wanting to write your own expression is **state, not something derivable from the value**. The
 * first version worked it out by asking "is the current pattern one of the presets?", so choosing
 * Custom while a preset was selected changed nothing anybody could see: the pattern was still the
 * preset's, so the menu snapped back to the preset and no box appeared. Remembering the choice is
 * the only thing that can tell "custom, which happens to equal the postcode pattern" apart from
 * "the postcode preset".
 */
function PatternRule({ field, patch }: { field: Field; patch: (changes: Partial<Field>) => void }) {
  const t = useT();
  const value =
    typeof (field as { pattern?: unknown }).pattern === 'string'
      ? ((field as { pattern?: string }).pattern ?? '')
      : '';
  const preset = Object.entries(PATTERN_PRESETS).find(([, source]) => source === value)?.[0];

  /** Reopened for a field that already carries an expression matching no preset. */
  const [writingOwn, setWritingOwn] = useState(value !== '' && preset === undefined);
  const showExpression = writingOwn || (value !== '' && preset === undefined);

  return (
    <div className="stack stack--tight">
      <label className="field">
        <span>{t('rules.pattern')}</span>
        <select
          value={
            value === '' && !writingOwn ? 'none' : showExpression ? 'custom' : (preset ?? 'custom')
          }
          onChange={(event) => {
            const chosen = event.target.value;
            if (chosen === 'none') {
              setWritingOwn(false);
              return patch({ pattern: undefined } as Partial<Field>);
            }
            if (chosen === 'custom') {
              setWritingOwn(true);
              // Whatever is already there is the starting point, so switching from a preset to
              // Custom means "let me edit this one" rather than "throw it away".
              return patch({ pattern: value || '.*' } as Partial<Field>);
            }
            setWritingOwn(false);
            patch({ pattern: PATTERN_PRESETS[chosen] } as Partial<Field>);
          }}
        >
          <option value="none">{t('rules.pattern.none')}</option>
          {Object.keys(PATTERN_PRESETS).map((name) => (
            <option key={name} value={name}>
              {t(`rules.pattern.${name}`)}
            </option>
          ))}
          <option value="custom">{t('rules.pattern.custom')}</option>
        </select>
      </label>

      {showExpression && (
        <label className="field">
          <span className="small muted">{t('rules.pattern.expression')}</span>
          <input
            value={value}
            spellCheck={false}
            onChange={(event) => patch({ pattern: event.target.value } as Partial<Field>)}
          />
          <span className="small muted">{t('rules.pattern.expressionHint')}</span>
        </label>
      )}
    </div>
  );
}

/** Matches the schema's own bounds, so the browser refuses what Zod would reject anyway. */
const NUMERIC_BOUNDS: Partial<Record<RuleName, { min?: number; max?: number; step?: number }>> = {
  minLength: { min: 0 },
  maxLength: { min: 1 },
  rows: { min: 2, max: 20 },
  decimals: { min: 0, max: 6 },
  minSelected: { min: 0 },
  maxSelected: { min: 1 },
  min: { step: 1 },
  max: { step: 1 },
};
