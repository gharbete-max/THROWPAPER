import { Link } from 'react-router';
import { pickText, type LocaleConfig } from '@tp/i18n';
import { canDelete, canEdit, canShare, type FormResponse } from '@tp/shared/forms';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';
import { CopyLink } from './CopyLink.js';

/**
 * One form in a list.
 *
 * Lifted out of the Forms screen when the bin arrived: a binned form and a live one are the same
 * card wearing different buttons, and two copies of the card that had to be kept looking alike was
 * how the response count and the link row came to differ between them in the first draft.
 *
 * Every button here is drawn from the `access` the server put on the form, using the predicates
 * from `@tp/shared` — the same functions the endpoints enforce with. A button this component draws
 * is a button the API will honour.
 */
export function FormCard({
  form,
  locale,
  locales,
  currentUserId,
  onTrash,
  onRestore,
  onDelete,
  onShare,
}: {
  form: FormResponse;
  locale: string;
  locales: LocaleConfig;
  /** To tell "by you" from "by Oskar" without a second lookup. */
  currentUserId: string | undefined;
  onTrash?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  onShare?: () => void;
}) {
  const t = useT();
  const name = pickText(locales, form.title, locale).value;
  const incomplete = form.completeness.filter((entry) => !entry.complete);
  const publicPath = `/f/${form.slug}`;
  const live = form.status === 'published';
  const binned = form.deletedAt !== null;

  const editable = canEdit(form.access);
  const removable = canDelete(form.access);

  return (
    <article className={binned ? 'card stack card--binned' : 'card stack'}>
      <div className="row row--between">
        <h2>{name || form.slug}</h2>
        {/* The status carries into the class so colour can say it too — a form that is live and
            taking answers is the one fact somebody scanning forty of them is looking for. */}
        <span className={`badge badge--${form.status}`}>{t(`forms.status.${form.status}`)}</span>
      </div>

      {/**
       * Who made it, and on what footing you are reading it.
       *
       * On "my forms" this is always "by you" and says little; on "shared with me" and on an
       * administrator's view of the whole organisation it is the first thing worth knowing.
       */}
      <p className="small muted row form-meta">
        <span>
          <Icon name="user" className="icon--lead" />
          {form.ownerUserId === null
            ? t('forms.ownerNobody')
            : form.ownerUserId === currentUserId
              ? t('forms.ownerYou')
              : t('forms.owner', { name: form.ownerName ?? '—' })}
        </span>
        {/**
         * The share wins the badge where there is one.
         *
         * An administrator holding an editor share has `access: 'admin'` — true, and what every
         * button here obeys — but labelling it "Administrator" on their "shared with me" tab hid
         * the fact that a colleague had deliberately handed them the form. `sharedRole` is the
         * share; `access` is the authority. The badge reports the first, the buttons the second.
         */}
        {form.sharedRole ? (
          <span className="badge badge--quiet">{t(`forms.access.${form.sharedRole}`)}</span>
        ) : (
          form.access === 'admin' && (
            <span className="badge badge--quiet">{t('forms.access.admin')}</span>
          )
        )}
        {form.shareCount > 0 && (
          <span>
            <Icon name="share" className="icon--lead" />
            {t('share.with', { count: form.shareCount })}
          </span>
        )}
      </p>

      <p className="small">
        <Icon name="inbox" className="icon--lead" />
        <strong>{t('forms.responses', { count: form.submissionCount })}</strong>
        <span className="muted">
          {' · '}
          {form.publishedVersion
            ? t('forms.version', { n: form.publishedVersion })
            : t('forms.unpublished')}
        </span>
      </p>

      {/* A binned form has no live address to offer, so the link row gives way to the date. */}
      {binned ? (
        <p className="small muted">
          <Icon name="trash" className="icon--lead" />
          {t('forms.trashedAt', {
            date: new Date(form.deletedAt ?? '').toLocaleDateString(locale),
          })}
        </p>
      ) : (
        <p className="small row form-link-row">
          {live ? (
            <a className="form-link" href={publicPath} target="_blank" rel="noopener noreferrer">
              <Icon name="external" className="icon--lead" />
              {publicPath}
            </a>
          ) : (
            <span className="muted">
              <Icon name="link" className="icon--lead" />
              {publicPath}
            </span>
          )}
          <CopyLink path={publicPath} />
        </p>
      )}

      {!binned && incomplete.length > 0 && (
        <p className="small status-warning">
          <Icon name="globe" className="icon--lead" />
          {t('forms.untranslated', {
            locales: incomplete.map((entry) => entry.locale).join(', '),
          })}
        </p>
      )}

      <div className="row card__actions">
        {binned ? (
          <>
            {removable && onRestore && (
              <button className="button button--quiet" onClick={onRestore}>
                <Icon name="undo" className="icon--lead" />
                {t('forms.restore')}
              </button>
            )}
            {removable && onDelete && (
              <button className="button button--quiet button--danger" onClick={onDelete}>
                <Icon name="trash" className="icon--lead" />
                {t('forms.deleteForever')}
              </button>
            )}
          </>
        ) : (
          <>
            <Link className="button button--quiet" to={`/forms/${form.id}/submissions`}>
              <Icon name="inbox" className="icon--lead" />
              {t('forms.viewResponses')}
            </Link>
            {editable && (
              <Link className="button button--quiet" to={`/forms/${form.id}`}>
                <Icon name="edit" className="icon--lead" />
                {t('forms.edit')}
              </Link>
            )}
            {canShare(form.access) && onShare && (
              <button className="button button--quiet" onClick={onShare}>
                <Icon name="share" className="icon--lead" />
                {t('share.title')}
              </button>
            )}
            {removable && onTrash && (
              <button className="button button--quiet" onClick={onTrash}>
                <Icon name="trash" className="icon--lead" />
                {t('forms.trash')}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
