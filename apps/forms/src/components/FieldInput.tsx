import type { ReactNode } from 'react';
import { pickText, type LocaleConfig } from '@tp/i18n';
import { parseRichTextBlock, type AnswerValue, type Field } from '@tp/shared/forms';

/**
 * One field, as the person filling in the form sees it.
 *
 * Lifted out of `PublicForm` so the builder's preview can render the *same* component. A preview
 * with its own renderer is worse than no preview: it drifts, and the first thing anybody learns is
 * not to trust it. Anything that looks right here looks the same to a respondent because it is the
 * same code.
 */
export function FieldInput({
  field,
  locale,
  locales,
  value,
  error,
  chooseLabel,
  yesLabel,
  noLabel,
  onChange,
}: {
  field: Field;
  locale: string;
  locales: LocaleConfig;
  value: AnswerValue;
  error: string | null;
  chooseLabel: string;
  yesLabel: string;
  noLabel: string;
  onChange: (key: string, value: AnswerValue) => void;
}) {
  const text = (source: Record<string, string> | undefined) =>
    source ? pickText(locales, source, locale).value : '';

  if (field.type === 'hidden' || field.type === 'page_break') return null;

  if (field.type === 'section_break') {
    return (
      <div className="stack">
        <h2>{text(field.label)}</h2>
        {field.helpText && <p className="muted small">{text(field.helpText)}</p>}
      </div>
    );
  }

  if (field.type === 'rich_text') {
    /**
     * Rendered as elements the parser chose, never as HTML the author wrote.
     *
     * The content is a plain string carrying three markers; `parseRichTextBlock` turns it into
     * spans holding three booleans, so the worst an author can produce is bold text. There is no
     * sanitiser here because there is nothing to sanitise — `<script>` typed into a text block
     * comes out as the literal characters, which is what somebody typing it asked for.
     */
    return (
      <div className="rich-text">
        {parseRichTextBlock(text(field.content)).map((spans, line) => (
          <p key={line}>
            {spans.map((span, at) => {
              let node: ReactNode = span.text;
              if (span.bold) node = <strong>{node}</strong>;
              if (span.italic) node = <em>{node}</em>;
              if (span.underline) node = <u>{node}</u>;
              return <span key={at}>{node}</span>;
            })}
          </p>
        ))}
      </div>
    );
  }

  if (field.type === 'image') {
    // A field with no picture chosen yet renders nothing rather than a broken image icon.
    if (!field.src) return null;
    return (
      <img
        className="form-image"
        src={field.src}
        alt={text(field.alt)}
        style={field.maxWidth ? { maxWidth: `${field.maxWidth}px` } : undefined}
      />
    );
  }

  if (field.type === 'link') {
    if (!field.href) return null;
    return (
      <a
        className={field.appearance === 'button' ? 'button button--quiet' : 'form-link'}
        href={field.href}
        target="_blank"
        /**
         * `noopener` is the one that matters: without it the opened page gets a handle on this
         * one through `window.opener` and can navigate a half-filled form somewhere else.
         */
        rel="noopener noreferrer"
      >
        {text(field.label) || field.href}
      </a>
    );
  }

  const label = text(field.label);
  const help = 'helpText' in field ? text(field.helpText) : '';
  const placeholder = 'placeholder' in field ? text(field.placeholder) : '';
  const required = 'required' in field ? field.required : false;

  /**
   * Grouped choices are a `fieldset` with a `legend`, not a `label` wrapped round several
   * inputs. A label may only name one control; wrapping a group makes clicking the question text
   * silently tick the first option, and leaves a screen reader announcing the wrong thing.
   */
  const group = choiceGroup(field, text, yesLabel, noLabel);
  if (group) {
    const selected = group.multiple
      ? new Set(Array.isArray(value) ? value.map(String) : [])
      : new Set(value === null || value === undefined ? [] : [String(value)]);

    return (
      <fieldset className={`choice choice--${group.appearance}`}>
        <legend>
          {label}
          {required && ' *'}
        </legend>

        <div className="choice__options">
          {group.options.map((option) => (
            <label className="choice__option" key={option.value}>
              <input
                type={group.multiple ? 'checkbox' : 'radio'}
                // A radio group needs a shared name, or every option becomes its own group and
                // more than one can be chosen at once.
                name={`${field.key}__${group.multiple ? 'check' : 'radio'}`}
                value={option.value}
                checked={selected.has(option.value)}
                onChange={(event) => {
                  if (!group.multiple) {
                    onChange(field.key, group.decode(option.value));
                    return;
                  }
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option.value);
                  else next.delete(option.value);
                  onChange(
                    field.key,
                    group.options.filter((o) => next.has(o.value)).map((o) => o.value),
                  );
                }}
              />
              {/* Decorative: the label beside it already names the choice, so a screen reader
                  reading both would say everything twice. */}
              {option.image && <img className="choice__image" src={option.image} alt="" />}
              <span>{option.label || option.value}</span>
            </label>
          ))}
        </div>

        {help && <span className="small muted">{help}</span>}
        {error && <span className="small status-down">{error}</span>}
      </fieldset>
    );
  }

  return (
    <label className="field">
      <span>
        {label}
        {required && ' *'}
      </span>

      {field.type === 'long_text' ? (
        <textarea
          rows={field.rows ?? 4}
          required={required}
          placeholder={placeholder}
          value={String(value ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      ) : field.type === 'single_select' ? (
        <select
          value={String(value ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          <option value="">{chooseLabel}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {text(option.label) || option.value}
            </option>
          ))}
        </select>
      ) : field.type === 'multi_select' ? (
        <span className="stack">
          {field.options.map((option) => {
            const selected = Array.isArray(value) ? value : [];
            return (
              <label className="field field--inline" key={option.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      field.key,
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((entry) => entry !== option.value),
                    )
                  }
                />
                <span>{text(option.label) || option.value}</span>
              </label>
            );
          })}
        </span>
      ) : field.type === 'yes_no' ? (
        <select
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(event) => onChange(field.key, event.target.value === 'true')}
        >
          <option value="">{chooseLabel}</option>
          <option value="true">{yesLabel}</option>
          <option value="false">{noLabel}</option>
        </select>
      ) : (
        <input
          type={inputType(field.type)}
          required={required}
          placeholder={placeholder}
          value={String(value ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}

      {help && <span className="small muted">{help}</span>}
      {error && <span className="small status-down">{error}</span>}
    </label>
  );
}

/**
 * The presentation an author chose for a choice field, flattened so the renderer does not care
 * which of the three field types it is looking at.
 *
 * Returns `null` for the appearances that are a single control — a dropdown is a `select`, and a
 * `select` is perfectly good at being one. Only the grouped appearances need building by hand.
 */
function choiceGroup(
  field: Field,
  text: (value: Record<string, string> | undefined) => string,
  yesLabel: string,
  noLabel: string,
): {
  appearance: string;
  multiple: boolean;
  options: Array<{ value: string; label: string; image: string | null }>;
  decode: (value: string) => AnswerValue;
} | null {
  if (field.type === 'single_select' && field.appearance !== 'dropdown') {
    return {
      appearance: field.appearance,
      multiple: false,
      options: field.options.map((option) => ({
        value: option.value,
        label: text(option.label),
        image: option.image,
      })),
      decode: (value) => value,
    };
  }

  if (field.type === 'multi_select') {
    return {
      appearance: field.appearance,
      multiple: true,
      options: field.options.map((option) => ({
        value: option.value,
        label: text(option.label),
        image: option.image,
      })),
      decode: (value) => value,
    };
  }

  if (field.type === 'yes_no' && field.appearance !== 'dropdown') {
    return {
      appearance: field.appearance,
      multiple: false,
      options: [
        { value: 'true', label: yesLabel, image: null },
        { value: 'false', label: noLabel, image: null },
      ],
      // The only appearance that stores something other than the option value it was given.
      decode: (value) => value === 'true',
    };
  }

  return null;
}

function inputType(type: Field['type']): string {
  switch (type) {
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}
