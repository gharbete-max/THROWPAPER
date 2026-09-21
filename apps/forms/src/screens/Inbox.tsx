import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { InboxEntry } from '@tp/shared/forms';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
import { EmptyState } from '../components/EmptyState.js';
import { Loading } from '../components/Loading.js';
import { Reveal } from '../components/Signed.js';

/**
 * Every response arriving on every form you can see, newest first.
 *
 * ## Why this, and not "forms I have filled in"
 *
 * "My submissions" is ambiguous in a form builder, and only one reading is buildable: respondents
 * are anonymous. Somebody answering a public form has no account here and never signs in, so
 * there is nobody for a submission to belong *to* in that sense — a "forms I filled in" screen
 * would be permanently empty for every user in the product.
 *
 * The reading that is both buildable and useful is the one JotForm and Typeform settled on: the
 * responses arriving on your forms, gathered across all of them. A form's author checks that
 * daily, and before this the only way to do it was to open each form's grid in turn and compare.
 *
 * It shows arrivals, not answers. Reading one is opening the form's own grid, which already knows
 * how to label a response against the version it was given under.
 */
export function Inbox() {
  const t = useT();
  const { locale, locales } = useSession();
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setFailed(false);
    client
      .inbox()
      .then((result) => setEntries(result.submissions))
      // Not `[]`: an empty list says "no responses yet", which is a claim about the data, and a
      // failed fetch knows nothing about the data.
      .catch(() => setFailed(true));
  }, [attempt]);

  /**
   * One box, matched against the three things somebody might type: a name, a reference read off
   * a printed card, or a form's title. Client-side, because the inbox is already capped at the
   * latest fifty and a round trip per keystroke would answer slower than the eye.
   */
  const shown = useMemo(() => {
    if (!entries) return null;
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.who, entry.reference, pickText(locales, entry.formTitle, locale).value]
        .join(' ')
        .toLocaleLowerCase(locale)
        .includes(needle),
    );
  }, [entries, query, locale, locales]);

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('inbox.title')}</h1>
        <p className="muted small">{t('inbox.intro')}</p>
      </header>

      {failed && (
        <EmptyState
          icon="warning"
          title={t('inbox.loadFailed')}
          action={
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t('public.retry')}
            </button>
          }
        />
      )}
      {!failed && entries === null && <Loading />}
      {entries?.length === 0 && <p className="muted empty">{t('inbox.empty')}</p>}

      {entries && entries.length > 0 && shown && (
        <>
          <div className="row row--between">
            <label className="field field--search">
              <span className="small muted">
                <Icon name="search" className="icon--lead" />
                {t('inbox.search')}
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {/* A count, so "did everyone register?" has a number on the same screen. */}
            <p className="small muted" aria-live="polite">
              {t('inbox.count', { count: shown.length })}
            </p>
          </div>

          <ul className="inbox">
            {shown.map((entry) => (
              <Reveal as="li" className="inbox__row" key={entry.id}>
                <Link className="inbox__link" to={`/forms/${entry.formId}/submissions`}>
                  {/*
                    The person first, the form second. Fourteen rows all bold "Spring meeting
                    registration" with the one thing that differed in grey answered nothing; the
                    name is what somebody scans for, and the reference stands in when a form
                    collected none.
                  */}
                  <span className="inbox__who">{entry.who || entry.reference}</span>
                  <span className="inbox__form small muted">
                    {pickText(locales, entry.formTitle, locale).value || entry.formSlug}
                    {entry.who && <span className="inbox__reference"> · {entry.reference}</span>}
                  </span>
                  <span className="inbox__status">
                    {/* Outlined, never filled: a filled badge takes the surface colour and the
                        inbox rows are that colour, so it disappeared into the row it sat on. */}
                    <span
                      className={
                        entry.status === 'complete'
                          ? 'badge badge--quiet'
                          : 'badge badge--quiet status-warning'
                      }
                    >
                      {t(entry.status === 'complete' ? 'inbox.complete' : 'inbox.partial')}
                    </span>
                  </span>
                  {/**
                   * The submission date, not the creation date, where there is one: a draft
                   * started in March and finished in May arrived in May, and sorting a list of
                   * arrivals by when somebody first opened the page reads as wrong.
                   */}
                  <span className="inbox__when small muted">
                    <Icon name="clock" className="icon--lead" />
                    {new Date(entry.submittedAt ?? entry.createdAt).toLocaleString(locale)}
                  </span>
                </Link>
              </Reveal>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
