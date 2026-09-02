import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { InboxEntry } from '@tp/shared/forms';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
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

  useEffect(() => {
    client
      .inbox()
      .then((result) => setEntries(result.submissions))
      .catch(() => setEntries([]));
  }, []);

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('inbox.title')}</h1>
        <p className="muted small">{t('inbox.intro')}</p>
      </header>

      {entries === null && <Loading />}
      {entries?.length === 0 && <p className="muted">{t('inbox.empty')}</p>}

      {entries && entries.length > 0 && (
        <ul className="inbox">
          {entries.map((entry) => (
            <Reveal key={entry.id}>
              <li className="inbox__row">
                <Link className="inbox__link" to={`/forms/${entry.formId}/submissions`}>
                  <span className="inbox__form">
                    {pickText(locales, entry.formTitle, locale).value || entry.formSlug}
                  </span>
                  <span className="inbox__reference small muted">{entry.reference}</span>
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
              </li>
            </Reveal>
          ))}
        </ul>
      )}
    </section>
  );
}
