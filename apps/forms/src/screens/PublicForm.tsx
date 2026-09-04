import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { pickText, resolveLocale, type LocaleConfig } from '@tp/i18n';
import { defaultTokens, toCssBlock } from '@tp/tokens';
import {
  isVisible,
  pagesOf,
  widthOf,
  validateSubmission,
  type AnswerValue,
  type PublicFormResponse,
  type SubmissionValues,
  type ValidationIssue,
} from '@tp/shared/forms';
import { useTranslator } from '../lib/i18n.js';
import { LanguagePicker } from '../components/LanguagePicker.js';
import { useAnnounceLocale } from '../lib/demo.js';
import { FieldInput } from '../components/FieldInput.js';
import { Icon } from '../components/Icon.js';
import { Meter } from '../components/Meter.js';
import { Signed } from '../components/Signed.js';

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
  const t = useTranslator(locales, resolved);

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
    ? pickText(locales, form.definition.settings.submitLabel, resolved).value ||
      t('public.complete')
    : t('public.complete');
  /**
   * The page, with conditionally hidden fields removed.
   *
   * Filtered here rather than inside the loop that renders it, so `validatePage` and the renderer
   * agree on exactly one list. Two lists is how you get an error under a field that is not there.
   */
  const currentPage = useMemo(
    () => (pages[page] ?? []).filter((field) => isVisible(field, values)),
    [pages, page, values],
  );

  /**
   * The next page in a direction that still has something on it.
   *
   * A page whose every field is conditionally hidden must be stepped over, not shown as a blank
   * screen with a Next button — that reads as a broken form, and it is the first thing anybody
   * hits when they put a whole section behind one condition. Returns `null` when there is nothing
   * further that way, which is what turns Next into Complete.
   */
  const nextPageWithContent = useCallback(
    (from: number, direction: 1 | -1): number | null => {
      for (let at = from + direction; at >= 0 && at < pages.length; at += direction) {
        const fields = pages[at] ?? [];
        if (fields.some((field) => isVisible(field, values))) return at;
      }
      return null;
    },
    [pages, values],
  );

  const forwardPage = nextPageWithContent(page, 1);
  const backPage = nextPageWithContent(page, -1);

  /**
   * Which step this is, out of the steps that actually exist for these answers.
   *
   * Pages hidden by conditions are not counted, so the bar reaches the end rather than stopping
   * at four fifths on a form that skipped a section.
   */
  const reachable = pages
    .map((fields, at) => ({ at, live: fields.some((field) => isVisible(field, values)) }))
    .filter((entry) => entry.live);
  const totalSteps = Math.max(1, reachable.length);
  const stepNumber = Math.max(1, reachable.findIndex((entry) => entry.at === page) + 1);

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
    setRejected(null);
    try {
      const response = await fetch(`/api/public/forms/${slug}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: resolved, values, resumeToken: resumeToken ?? undefined }),
      });
      /**
       * A failed save has to say so.
       *
       * It returned silently before: the button finished, no link appeared, and somebody who had
       * asked to come back later walked away believing their answers were kept. The link is the
       * only copy — there is nothing else to return to.
       */
      if (!response.ok) {
        setRejected('error');
        return;
      }
      const saved = (await response.json()) as { resumeToken: string };
      setResumeToken(saved.resumeToken);
      setResumeLink(`${window.location.origin}/f/${slug}?resume=${saved.resumeToken}`);
    } catch {
      setRejected('offline');
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
      /**
       * A body that will not parse is not a reason to lose the answers.
       *
       * A gateway timing out in front of the API answers with an HTML error page, and `json()`
       * throws on it. That threw out of the whole function, so the one status code most likely to
       * appear under load produced no message at all.
       */
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);

      if (response.status === 201) {
        setReference(body.reference);
        setConfirmation(body.confirmationMessage);
        setPhase('done');

        /**
         * A form can send people somewhere of its own instead of the thank-you screen.
         *
         * The reference goes with them: an event registration whose reference is lost at the
         * redirect cannot be checked in at the door, which would make the feature a trap.
         *
         * The URL is `http`/`https` by schema — `javascript:` in an author-supplied string would
         * be script execution against every visitor. `assign`, not `replace`, so the browser's
         * Back button still returns to the confirmation rather than resubmitting the form.
         */
        const destination = form.definition.settings.redirectUrl;
        if (destination) {
          const target = new URL(destination);
          if (body.reference) target.searchParams.set('reference', String(body.reference));
          window.location.assign(target.toString());
        }
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
      /**
       * A fault at our end is not a closed form.
       *
       * Anything unrecognised used to fall through to `'closed'`, so a 500 told the visitor "The
       * form closed while you were filling this in." That is a false statement, and it is the kind
       * that makes somebody give up rather than press the button again — which is exactly what
       * would have worked.
       */
      if (response.status >= 500) {
        setRejected('error');
        return;
      }
      setRejected(String(body.reason ?? 'closed'));
    } catch {
      /**
       * The connection went, not the answers.
       *
       * This is a phone on a venue's wifi at the end of a long form. Nothing here clears `values`,
       * so everything typed is still on the page and pressing the button again is a real fix —
       * but only if somebody is told that. Before, the promise rejected into nothing: the button
       * un-greyed itself and the page said absolutely nothing.
       */
      setRejected('offline');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The title in whichever language this reader has chosen, falling back the way every other
   * string on this page does.
   */
  const formTitle = form ? pickText(locales, form.title, resolved).value : '';

  /**
   * The tab, too.
   *
   * The server sends a per-form `<title>` for crawlers; a browser that has already loaded the app
   * and navigated within it never asks the server again, so without this the tab says "Formwork"
   * for every form somebody has open at once.
   *
   * Above the early returns, with the other hooks. It sat below them at first, so the loading
   * render called one fewer hook than the loaded one — "rendered more hooks than during the
   * previous render", and the page stopped rendering at all. A screen with four exits is exactly
   * where that mistake hides.
   */
  useEffect(() => {
    if (!formTitle) return;
    const previous = document.title;
    document.title = `${formTitle} — ${form?.organisationName ?? ''}`.trim();
    return () => {
      document.title = previous;
    };
  }, [formTitle, form?.organisationName]);

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
        {/**
         * The form's own language switcher, separate from the site's.
         *
         * The site is in one language at a time and that is a personal setting. A *form* is a
         * document, and a Swedish association with English-speaking members publishes one form
         * that reads in both — so the reader flips between them here, with a flag in the corner,
         * without anything about their account changing.
         *
         * Which languages appear is the author's choice (`settings.locales`), not the whole
         * organisation's list: offering a switcher to ten versions nobody translated is worse
         * than offering none. `LanguagePicker` renders nothing below two, so a single-language
         * form simply has no corner control.
         *
         * Switching re-renders labels from the same `values` state, so changing language
         * mid-flow cannot lose what has already been typed.
         */}
        <LanguagePicker
          locales={form?.supportedLocales ?? []}
          current={resolved}
          onChange={setLocale}
          // The form's translator, not the session's — the switcher belongs to this document.
          t={t}
          variant="corner"
        />
      </header>

      {/*
        What this is.
        
        The page had no heading: the organisation's name, then a first question. Somebody who
        followed a link from a chat window saw a card naming the form, opened it, and arrived
        somewhere that did not name it — which is the moment a careful person closes the tab.

        `h1` and not a caption: on a page whose whole purpose is one document, the document's name
        is the heading, and a screen reader jumping by heading should land on it.
      */}
      {formTitle && phase !== 'done' && <h1 className="public__title">{formTitle}</h1>}

      {phase === 'closed' && (
        <div className="card">
          <p>{t(`public.closed.${form?.closedReason ?? 'closed'}`)}</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="card stack done">
          {/* Drawn rather than already there: a mark appearing *now* is what says it worked,
              which is the thing people are unsure about on a confirmation screen. */}
          <Signed />
          <h1>{confirmation || t('public.thanks')}</h1>
          <p className="muted">{t('public.reference', { reference })}</p>
        </div>
      )}

      {phase === 'filling' && form && (
        <form className="stack" onSubmit={submit}>
          {/**
           * Progress, counted over the pages that are actually reachable.
           *
           * Counting every page break would say "step 2 of 5" on a form where conditions have
           * hidden three of them — a bar that never fills, which is worse than none.
           */}
          {pages.length > 1 && form.definition.settings.showProgress && (
            <div className="stack stack--tight">
              <p className="small muted">
                {t('public.progress', { n: stepNumber, total: totalSteps })}
              </p>
              <Meter
                value={stepNumber}
                max={totalSteps}
                label={t('public.progress', { n: stepNumber, total: totalSteps })}
              />
            </div>
          )}

          {/*
            A grid rather than a stack, so a field can say it wants half a row and get it. Every
            width collapses to full below 600px — a two-column form on a phone is two cramped
            columns, not a clever layout.
          */}
          <div className="form-grid">
            {currentPage.map((field) => (
              <div className={`form-grid__cell form-grid__cell--${widthOf(field)}`} key={field.id}>
                <FieldInput
                  field={field}
                  slug={slug}
                  locale={resolved}
                  locales={locales}
                  value={values[field.key]}
                  error={issueFor(field.key)}
                  chooseLabel={t('public.choose')}
                  yesLabel={t('public.yes')}
                  noLabel={t('public.no')}
                  onChange={setValue}
                />
              </div>
            ))}
          </div>

          {/*
            `alert`, because this appears in response to pressing the button rather than as part of
            the page. Without it a screen reader announces nothing at all: focus stays on a button
            whose label has gone back to "Complete", which reads as though the form simply refused.
          */}
          {rejected && (
            <p className="status-down" role="alert">
              {t(`public.rejected.${rejected}`)}
            </p>
          )}

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

          {/*
            Back on the left, forward on the right, the way every multi-step form works — the
            previous layout put all three actions in a left-aligned row, so "Next" sat between
            "Back" and "Save", which is the last place anybody looks for it.

            On the final page the forward action is the submit, and it says so: "Complete" rather
            than a second "Next" that happens to end the form.
          */}
          <div className="row row--between form-actions">
            <div className="row">
              {backPage !== null && (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setPage(backPage)}
                >
                  <Icon name="arrow-left" />
                  {t('public.back')}
                </button>
              )}

              {form.definition.settings.allowSaveAndResume && (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={saveDraft}
                  disabled={busy}
                >
                  <Icon name="save" />
                  {busy ? t('public.saving') : t('public.save')}
                </button>
              )}
            </div>

            {forwardPage !== null ? (
              <button
                type="button"
                className="button form-actions__forward"
                onClick={() => {
                  if (validatePage()) setPage(forwardPage);
                }}
              >
                {t('public.next')}
                <Icon name="arrow-right" />
              </button>
            ) : (
              <button type="submit" className="button form-actions__forward" disabled={busy}>
                <Icon name="check" />
                {busy ? t('public.submitting') : submitLabel}
              </button>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
