import { useRef, useState } from 'react';
import { toggleMarker } from '@tp/shared/forms';
import { useT } from '../../lib/i18n.js';

/**
 * One piece of text, in the language being worked in, with other languages behind a plus.
 *
 * The builder used to put every locale of every string on a parallel "Translation" tab, which made
 * translation feel compulsory: a second language existed for the organisation, so every field was
 * incomplete until somebody filled it in, whether or not they ever intended to publish in it.
 *
 * Here a second language is something you ask for. Until you do, there is one box. A locale with
 * no text of its own falls back to the one that has some when the form is rendered, so leaving it
 * alone is a real choice rather than an unfinished state.
 */
export function LocalisedField({
  label,
  value,
  locale,
  supported,
  multiline = false,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: Record<string, string> | undefined;
  /** The language being edited — the one box that is always shown. */
  locale: string;
  supported: readonly string[];
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  onChange: (locale: string, text: string) => void;
}) {
  const t = useT();
  const text = value ?? {};
  const boxes = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({});

  /**
   * Shown when it already has text, so reopening a form does not hide translations somebody has
   * already written — the plus is for adding a language, not for finding one.
   */
  const alreadyTranslated = supported.filter(
    (candidate) => candidate !== locale && (text[candidate] ?? '') !== '',
  );
  const [revealed, setRevealed] = useState<string[]>([]);
  const shown = [...new Set([...alreadyTranslated, ...revealed])];
  const available = supported.filter(
    (candidate) => candidate !== locale && !shown.includes(candidate),
  );

  const Input = multiline ? 'textarea' : 'input';

  /**
   * Applies a marker to whatever is selected in the box beside the button.
   *
   * Reads the selection off the DOM rather than tracking it in state: a controlled selection would
   * have to be kept in step with every keystroke, and the browser already knows the answer.
   */
  function format(marker: '*' | '/' | '_') {
    const box = boxes.current[locale];
    if (!box) return;
    const next = toggleMarker(box.value, box.selectionStart ?? 0, box.selectionEnd ?? 0, marker);
    if (next.value === box.value) return;
    onChange(locale, next.value);
    // Restore the selection after React re-renders, so a second click toggles the same words.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div className="stack localised">
      <label className="field">
        <span>
          {label}
          {supported.length > 1 && <span className="small muted"> · {locale}</span>}
        </span>
        <Input
          ref={(element: HTMLTextAreaElement | HTMLInputElement | null) => {
            boxes.current[locale] = element;
          }}
          value={text[locale] ?? ''}
          placeholder={placeholder}
          rows={multiline ? 3 : undefined}
          onChange={(event: { target: { value: string } }) => onChange(locale, event.target.value)}
        />

        {multiline && (
          <span className="row rich-toolbar">
            {(
              [
                ['*', 'bold', <strong key="b">B</strong>],
                ['/', 'italic', <em key="i">I</em>],
                ['_', 'underline', <u key="u">U</u>],
              ] as const
            ).map(([marker, name, glyph]) => (
              <button
                key={marker}
                type="button"
                className="button button--quiet button--icon small"
                title={t(`brand.${name}`)}
                aria-label={t(`brand.${name}`)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format(marker)}
              >
                {glyph}
              </button>
            ))}
            <span className="small muted">{t('field.formatHint')}</span>
          </span>
        )}
        {hint && <span className="small muted">{hint}</span>}
      </label>

      {shown.map((other) => (
        <label className="field localised__other" key={other}>
          <span className="small muted">
            {label} · {other}
          </span>
          <Input
            value={text[other] ?? ''}
            rows={multiline ? 3 : undefined}
            onChange={(event: { target: { value: string } }) => onChange(other, event.target.value)}
          />
        </label>
      ))}

      {available.length > 0 && (
        <div className="row localised__add">
          {available.map((other) => (
            <button
              key={other}
              type="button"
              className="button button--quiet small"
              onClick={() => setRevealed((current) => [...current, other])}
            >
              + {t('field.addLanguage', { locale: other })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
