import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BUILDER_GRAPH, type Conversation } from '@tp/shared/builder';
import { LoadFailed } from '../../../components/LoadFailed.js';
import { Loading } from '../../../components/Loading.js';
import { client } from '../../../lib/api.js';
import { useEdition } from '../../../lib/edition.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { startConversation, type Started } from './conversation.js';
import { Saver, type SaveStatus } from './saver.js';
import { Shell } from './Shell.js';

/**
 * "Start from questions" — the guided conversation about one form, at `/forms/:id/guided`.
 *
 * It reads the form, its saved conversation and whether a brand kit exists; starts or resumes
 * (`startConversation`); and saves every step (`Saver`). The editor is one press away, and is
 * where the form is published: both edit the same draft.
 */
export function GuidedBuilder() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const edition = useEdition();
  const { locale, locales, contentLocale } = useSession();

  const [started, setStarted] = useState<Started | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const saver = useRef<Saver | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setFailed(false);
    setStarted(null);
    setConversation(null);
    Promise.all([
      client.getForm(id),
      client.builderSession(id),
      client.brandKit().catch(() => null),
    ])
      .then(([form, stored, brand]) => {
        const begun = startConversation({
          graph: BUILDER_GRAPH,
          definition: form.draftDefinition,
          title: form.title,
          stored: stored.session,
          brandKitExists: brand?.customised ?? false,
        });
        saver.current = new Saver(
          client,
          BUILDER_GRAPH,
          id,
          { version: stored.version, draft: form.draftDefinition },
          setStatus,
        );
        setStatus('saved');
        setStarted(begun);
        setConversation(begun.conversation);
      })
      .catch(() => setFailed(true));
  }, [id]);

  useEffect(load, [load]);

  function onChange(next: Conversation) {
    setConversation(next);
    void saver.current?.save(next);
  }

  /** To the editor — once the last step is saved, because the editor reads the draft. */
  async function openEditor() {
    const current = saver.current;
    if (current) {
      await current.settled();
      if (current.status === 'failed') await current.retry();
      // Leaving now would open the editor on a draft without the last steps: stay, and say so.
      if (current.status === 'failed') return;
    }
    navigate(`/forms/${id}`);
  }

  if (failed) return <LoadFailed onRetry={load} />;
  if (!started || !conversation) return <Loading />;

  const discarded = started.kind === 'fresh' ? started.discarded : null;

  return (
    <section className="stack">
      {discarded && (
        <p className="conversation__started-again" role="status">
          {t(
            discarded === 'changed-elsewhere'
              ? 'conversation.startedAgain'
              : 'conversation.unreadable',
          )}
        </p>
      )}
      <Shell
        graph={BUILDER_GRAPH}
        conversation={conversation}
        onChange={onChange}
        locales={{ interfaceLocale: locale, contentLocale }}
        contentLocales={locales}
        desktop={edition === 'desktop'}
        onOpenEditor={() => void openEditor()}
        status={
          <SaveState status={status} onRetry={() => void saver.current?.retry()} onReload={load} />
        }
      />
    </section>
  );
}

/**
 * Whether the latest step is saved. Quiet while it is; a way forward when it is not: try again, or
 * — when another tab saved over this one — read the form again rather than overwrite that tab.
 */
function SaveState({
  status,
  onRetry,
  onReload,
}: {
  status: SaveStatus;
  onRetry: () => void;
  onReload: () => void;
}) {
  const t = useT();
  return (
    <span className="small muted" role="status">
      {t(`conversation.status.${status}`)}
      {status === 'failed' && (
        <button type="button" className="button button--bare" onClick={onRetry}>
          {t('conversation.retry')}
        </button>
      )}
      {status === 'conflict' && (
        <button type="button" className="button button--bare" onClick={onReload}>
          {t('conversation.reload')}
        </button>
      )}
    </span>
  );
}
