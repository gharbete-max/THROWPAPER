import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { pickText } from '@tp/i18n';
import type { FormResponse } from '@tp/shared/forms';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
import { Submissions } from './Submissions.js';

/**
 * Responses to one form, on a page of their own.
 *
 * They used to live at the bottom of the builder, below the palette, the canvas, the properties
 * panel and the live preview — so reading your results meant opening the editor for a published
 * form and scrolling past everything you might accidentally change on the way. Answers and the
 * thing that collects them are two different jobs, and only one of them is done every week.
 */
export function FormResponses() {
  const { id } = useParams();
  const t = useT();
  const { locale, locales } = useSession();
  const [form, setForm] = useState<FormResponse | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) return;
    client
      .getForm(id)
      .then(setForm)
      .catch(() => setMissing(true));
  }, [id]);

  if (!id || missing) return <p className="muted">{t('forms.empty')}</p>;
  if (!form) return <p className="muted">{t('app.loading')}</p>;

  const name = pickText(locales, form.title, locale).value || form.slug;

  return (
    <section className="stack">
      <div className="row row--between">
        <div className="stack stack--tight">
          <Link className="backlink small" to="/forms">
            <Icon name="arrow-left" className="icon--lead" />
            {t('forms.title')}
          </Link>
          <h1>{name}</h1>
        </div>
        <Link className="button button--quiet" to={`/forms/${form.id}`}>
          <Icon name="edit" className="icon--lead" />
          {t('forms.edit')}
        </Link>
      </div>

      {form.publishedVersion === null ? (
        <p className="muted">{t('submissions.notPublished')}</p>
      ) : (
        <Submissions formId={id} />
      )}
    </section>
  );
}
