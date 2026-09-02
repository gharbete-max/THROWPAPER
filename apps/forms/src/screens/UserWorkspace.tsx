import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { pickText } from '@tp/i18n';
import type { FormResponse, FormScope, UserSummary } from '@tp/shared/forms';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { useConfirm } from '../components/Confirm.js';
import { Icon } from '../components/Icon.js';
import { Loading } from '../components/Loading.js';
import { Reveal } from '../components/Signed.js';
import { FormCard } from '../components/FormCard.js';
import { ScopeTabs } from '../components/ScopeTabs.js';

/**
 * One colleague's workspace, seen by an administrator doing support work.
 *
 * ## Looking, not becoming
 *
 * This is deliberately **not** impersonation. The administrator's own token makes every request;
 * the server answers "here is what that person's workspace contains" and records the visit under
 * the administrator's name. Nothing about the session changes.
 *
 * Minting a session as the other user would be the shorter route and is the wrong one: every
 * action taken during it lands in the audit log as *their* action, so the log stops being able to
 * answer the only question it exists for. The banner at the top of this screen says whose
 * workspace it is and whose hands are on it, because an administrator who forgets which they are
 * looking at is the failure this design is avoiding.
 *
 * The tabs are the same three the person themselves has, so "look in their bin" is one click and
 * needs no explaining.
 */
export function UserWorkspace() {
  const t = useT();
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const { locale, locales, user } = useSession();
  const [scope, setScope] = useState<FormScope>('mine');
  const [forms, setForms] = useState<FormResponse[] | null>(null);
  const [person, setPerson] = useState<UserSummary | null | 'missing'>(null);

  useEffect(() => {
    client
      .listUsers()
      .then((result) => setPerson(result.users.find((entry) => entry.id === id) ?? 'missing'))
      .catch(() => setPerson('missing'));
  }, [id]);

  const load = useCallback(() => {
    if (!id) return;
    setForms(null);
    client
      .userForms(id, scope)
      .then((result) => setForms(result.forms))
      .catch(() => setForms([]));
  }, [id, scope]);

  useEffect(load, [load]);

  async function restore(form: FormResponse) {
    await client.restoreForm(form.id);
    load();
  }

  async function destroy(form: FormResponse) {
    const name = pickText(locales, form.title, locale).value || form.slug;
    const sure = await confirm(
      t('forms.confirmDelete', { title: name, count: form.submissionCount }),
      { confirmLabel: t('forms.deleteForever'), danger: true },
    );
    if (!sure) return;
    await client.deleteForm(form.id);
    load();
  }

  if (person === 'missing') return <p className="muted">{t('users.notFound')}</p>;

  return (
    <section className="stack">
      {/* In a row, or the stack stretches it across the page — a back link is not a call to
          action and should be the width of its own words. */}
      <div className="row">
        <Link className="button button--quiet small" to="/users">
          <Icon name="arrow-left" className="icon--lead" />
          {t('users.back')}
        </Link>
      </div>

      <header className="stack stack--tight">
        <h1>{person?.name ?? '…'}</h1>
        <p className="small muted">{person?.email}</p>
      </header>

      {/**
       * The one thing this screen must never let anybody forget. Styled as a notice rather than a
       * quiet caption: an administrator reading somebody else's work should be able to tell at a
       * glance, from across a desk, that this is not their own workspace.
       */}
      <p className="notice small">
        <Icon name="warning" className="icon--lead" />
        {t('users.viewingAs', { name: person?.name ?? '' })}
      </p>

      <ScopeTabs
        scopes={['mine', 'shared', 'trash']}
        current={scope}
        onChange={setScope}
        label={t('users.title')}
        perspective="third"
      />

      {forms === null && <Loading />}
      {forms?.length === 0 && (
        <p className="muted">{scope === 'trash' ? t('scope.emptyTrash') : t('forms.empty')}</p>
      )}

      {forms?.map((form) => (
        <Reveal key={form.id}>
          {/**
           * No share button and no trash button: this screen is for helping somebody, and the two
           * actions an administrator might reach for by accident are the two that change who can
           * see the work. Restoring from the bin is the support action people actually ask for,
           * so that one is here.
           */}
          <FormCard
            form={form}
            locale={locale}
            locales={locales}
            currentUserId={user?.id}
            onRestore={() => void restore(form)}
            onDelete={() => void destroy(form)}
          />
        </Reveal>
      ))}
    </section>
  );
}
