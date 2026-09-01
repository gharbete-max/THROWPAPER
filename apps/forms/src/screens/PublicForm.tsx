import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { createTranslator, pickText, resolveLocale, type LocaleConfig } from '@tp/i18n';
import { defaultTokens, toCssBlock } from '@tp/tokens';
import {
  pagesOf,
  validateSubmission,
  type AnswerValue,
  type Field,
  type PublicFormResponse,
  type SubmissionValues,
  type ValidationIssue,
} from '@tp/shared/forms';
import { messages } from '../lib/messages.js';
import { useAnnounceLocale } from '../lib/demo.js';

type Phase = 'loading' | 'filling' | 'done' | 'closed' | 'missing';

/**
 * The public form. No authentication, no session — the only screen anonymous people reach.
 *
 * It carries its own locale state rather than the signed-in session's, because the visitor's
 * language has nothing to do with whoever built the form. Switching language must never lose
 * entered answers: `values` lives above the locale, so re-rendering in another language re-labels
 * the same state (START-HERE explicitly lists this as an acceptance criterion).
 */
export default function PublicForm() {
  const { slug } = useParams();
  const [params] = useSearchParams();

  const [form, setForm] = useState<PublicFormResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [locale, setLocale] = useState<string>(navigator.language);
  const [values, setValues] = useState<SubmissionValues>({});
  const [page, setPage] = useState(0);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [reference, setReference] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [rejected, setRejected] = useState<string | null>(null);
  const [resumeToken, setResumeToken] = useState<string | null>(params.get('resume'));
  const [resumeLink, setResumeLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const locales: LocaleConfig = useMemo(
    () =>
      form
        ? { supported: form.supportedLocales, default: form.defaultLocale }
        : { supported: ['sv-SE'], default: 'sv-SE' },
    [form],
  );
  const resolved = resolveLocale(locales, locale);
  const t = useMemo(() => createTranslator(locales, messages, resolved), [locales, resolved]);

  // The banner lives above the router and would otherwise stay in the session's language.
  useAnnounceLocale(resolved);

  /**
   * The public page is not inside the app shell, so it applies the brand itself.
   *
   * The defaults go up immediately and are replaced when the form arrives with the organisation's
   * kit. Waiting for the fetch would leave the page unstyled for a moment; painting the defaults
   * first means the worst case is a brief flash of the wrong palette rather than of no palette.
   */
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = toCssBlock(form?.brand ?? defaultTokens);
    document.head.appendChild(style);
    return () => style.remove();
  }, [form?.brand]);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/public/forms/${slug}`)
      .then((response) => (response.ok ? (response.json() as Promise<PublicFormResponse>) : null))
      .then((loaded) => {
        if (!loaded) {
          setPhase('missing');
          return;
        }
        setForm(loaded);
        setPhase(loaded.open ? 'filling' : 'closed');
        // Hidden fields prefill from the query string — SPEC-forms.md §3.
        const prefilled: SubmissionValues = {};
        for (const field of loaded.definition.fields) {
          if (field.type === 'hidden') {
            const fromQuery = field.fromParameter ? params.get(field.fromParameter) : null;
            prefilled[field.key] = fromQuery ?? field.defaultValue ?? null;
          }
        }
        setValues((current) => ({ ...prefilled, ...current }));
      })
      .catch(() => setPhase('missing'));
  }, [slug, params]);

  // Resuming replaces the answers, and the locale the draft was saved in.
  useEffect(() => {
    const token = params.get('resume');
    if (!slug || !token) return;
    fetch(`/api/public/forms/${slug}/resume/${token}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((draft: { locale: string; values: SubmissionValues } | null) => {
        if (!draft) return;
        setValues(draft.values);
        setLocale(draft.locale);
        setResumeToken(token);
      })
      .catch(() => undefined);
  }, [slug, params]);

  const pages = useMemo(() => (form ? pagesOf(form.definition) : []), [form]);

  /**
   * The builder lets an operator write their own submit label per locale. Falling back to the
   * generic string only when they have not — before this, the setting was collected and ignored.
   */
  const submitLabel = form
    ? pickText(locales, form.definition.settings.submitLabel, resolved).value || t('public.submit')
    : t('public.submit');
  const currentPage = pages[page] ?? [];

  const setValue = useCallback((key: string, value: AnswerValue) => {
    setValues((current) => ({ ...current, [key]: value }));
    setIssues((current) => current.filter((issue) => issue.key !== key));
  }, []);

  function issueFor(key: string) {
    const issue = issues.find((candidate) => candidate.key === key);
    return issue ? t(issue.code, issue.params) : null;
  }

  /** Validate only the page in front of the visitor, so page 1 does not complain about page 2. */
  function validatePage(): boolean {
    if (!form) return false;
    const keys = new Set(currentPage.map((field) => field.key));
    const result = validateSubmission(form.definition, values);
    const pageIssues = result.issues.filter((issue) => keys.has(issue.key));
    setIssues(pageIssues);
    return pageIssues.length === 0;
  }

  async function saveDraft() {
    if (!slug || !form) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/public/forms/${slug}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: resolved, values, resumeToken: resumeToken ?? undefined }),
      });
      if (!response.ok) return;
      const saved = (await response.json()) as { resumeToken: string };
      setResumeToken(saved.resumeToken);
      setResumeLink(`${window.location.origin}/f/${slug}?resume=${saved.resumeToken}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!slug || !form || !validatePage()) return;

    setBusy(true);
    setRejected(null);
    try {
      const response = await fetch(`/api/public/forms/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale: resolved,
          values,
          resumeToken: resumeToken ?? undefined,
          // Honeypot: left empty by anyone who can see the page.
          website: '',
        }),
      });
      const body = await response.json();

      if (response.status === 201) {
        setReference(body.reference);
        setConfirmation(body.confirmationMessage);
        setPhase('done');
        return;
      }
      if (response.status === 422) {
        setIssues(body.issues ?? []);
        // Send the visitor back to the first page that has a problem.
        const firstBad = pages.findIndex((fields) =>
          fields.some((field) =>
            body.issues?.some((issue: ValidationIssue) => issue.key === field.key),
          ),
        );
        if (firstBad >= 0) setPage(firstBad);
        return;
      }
      setRejected(String(body.reason ?? 'closed'));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') return <main className="shell shell--narrow" />;

  if (phase === 'missing') {
    return (
      <main className="shell shell--narrow">
        <p className="muted">{t('public.notFound')}</p>
      </main>
    );
  }

  return (
    <main className="shell shell--narrow stack">
      <header className="row row--between">
        {/* The name is the alt text rather than a caption: a logo already says who this is. */}
        {form?.brand.logoLight ? (
          <img className="brand-mark" src={form.brand.logoLight} alt={form.organisationName} />
        ) : (
          <strong>{form?.organisationName}</strong>
        )}
        {/*
          The dropdown re-renders labels from the same `values` state, so switching language mid
          flow cannot lose what has been typed.
        */}
        <select
          aria-label="language"
          value={resolved}
          onChange={(event) => setLocale(event.target.value)}
        >
          {form?.supportedLocales.map((supported) => (
            <option key={supported} value={supported}>
              {supported}
            </option>
          ))}
        </select>
      </header>

      {phase === 'closed' && (
        <div className="card">
          <p>{t(`public.closed.${form?.closedReason ?? 'closed'}`)}</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="card stack">
          <h1>{confirmation || t('public.thanks')}</h1>
          <p className="muted">{t('public.reference', { reference })}</p>
        </div>
      )}

      {phase === 'filling' && form && (
        <form className="stack" onSubmit={submit}>
          {pages.length > 1 && (
            <p className="small muted">{t('public.page', { n: page + 1, total: pages.length })}</p>
          )}

          {currentPage.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              locale={resolved}
              locales={locales}
              value={values[field.key]}
              error={issueFor(field.key)}
              chooseLabel={t('public.choose')}
              yesLabel={t('public.yes')}
              noLabel={t('public.no')}
              onChange={setValue}
            />
          ))}

          {rejected && <p className="status-down">{t(`public.rejected.${rejected}`)}</p>}

          {resumeLink && (
            <div className="card stack">
              <strong>{t('public.savedTitle')}</strong>
              <p className="small muted">{t('public.savedBody')}</p>
              <input readOnly value={resumeLink} onFocus={(event) => event.target.select()} />
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  navigator.clipboard?.writeText(resumeLink).then(
                    () => setCopied(true),
                    () => undefined,
                  );
                }}
              >
                {copied ? t('public.copied') : t('public.copy')}
              </button>
            </div>
          )}

          <div className="row">
            {page > 0 && (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setPage(page - 1)}
              >
                {t('public.back')}
              </button>
            )}

            {page < pages.length - 1 ? (
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (validatePage()) setPage(page + 1);
                }}
              >
                {t('public.next')}
              </button>
            ) : (
              <button type="submit" className="button" disabled={busy}>
                {busy ? t('public.submitting') : submitLabel}
              </button>
            )}

            {form.definition.settings.allowSaveAndResume && (
              <button
                type="button"
                className="button button--quiet"
                onClick={saveDraft}
                disabled={busy}
              >
                {busy ? t('public.saving') : t('public.save')}
              </button>
            )}
          </div>
        </form>
      )}
    </main>
  );
}

function FieldInput({
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
    // Rendered as text, never as HTML — the definition is operator-authored but the page is public.
    return (
      <p>
        {text(field.content)
          .split('\n')
          .map((line, index) => (
            <span key={index}>
              {line}
              <br />
            </span>
          ))}
      </p>
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
