import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BUILDER_GRAPH, type Conversation } from '@tp/shared/builder';
import type { FormTemplate } from '@tp/shared/forms';
import {
  BUILTIN_ALIASES,
  type AliasRefusalReason,
  type LearnedAlias,
  type RememberAlias,
} from '@tp/shared/interpret';
import type { TokenSet } from '@tp/tokens';
import { LoadFailed } from '../../../components/LoadFailed.js';
import { Loading } from '../../../components/Loading.js';
import { ApiError, client } from '../../../lib/api.js';
import { useBrand } from '../../../lib/brand.js';
import { useEdition } from '../../../lib/edition.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { presetById, withPreset } from '../../../lib/theme-preset.js';
import { startConversation, type Remembered, type Started } from './conversation.js';
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
  const { locale, locales, contentLocale, organisation, user } = useSession();
  const { refresh: repaint } = useBrand();
  /** Only an administrator may change the organisation's colours (owner question 8). */
  const canChangeBrand = user?.role === 'admin';

  const [started, setStarted] = useState<Started | null>(null);
  /**
   * The organisation's brand kit: whether it has one of its own, and its logo, for the preview; and
   * its tokens, which a preset is applied over. Null tokens: the kit could not be read, so a preset
   * is not applied — it would be saved over a logo nobody could see.
   */
  const [kit, setKit] = useState<{
    customised: boolean;
    logo: string | null;
    tokens: TokenSet | null;
  }>({ customised: false, logo: null, tokens: null });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const saver = useRef<Saver | null>(null);
  /** The organisation's learned aliases: the ladder reads them with the built-in ones. */
  const [learned, setLearned] = useState<readonly LearnedAlias[]>([]);
  const [templates, setTemplates] = useState<readonly FormTemplate[]>([]);
  // One array for as long as nothing is learned: the ladder keeps its vocabulary per array.
  const aliases = useMemo(() => [...BUILTIN_ALIASES, ...learned], [learned]);

  const load = useCallback(() => {
    if (!id) return;
    setFailed(false);
    setStarted(null);
    setConversation(null);
    Promise.all([
      client.getForm(id),
      client.builderSession(id),
      client.brandKit().catch(() => null),
      // Without them the built-in aliases still read everything they did: never a reason to fail.
      client.learnedAliases().catch(() => ({ aliases: [] })),
      // What "Right" adds from, as the gallery has it. Without it the guess still guesses; "Right"
      // on a template is then refused and says so (S11).
      client.formTemplates().catch(() => ({ templates: [] })),
    ])
      .then(([form, stored, brand, known, catalogue]) => {
        setLearned(known.aliases);
        setTemplates(catalogue.templates);
        const begun = startConversation({
          graph: BUILDER_GRAPH,
          definition: form.draftDefinition,
          title: form.title,
          stored: stored.session,
          brandKitExists: brand?.customised ?? false,
          canChangeBrand,
        });
        saver.current = new Saver(
          client,
          BUILDER_GRAPH,
          id,
          { version: stored.version, draft: form.draftDefinition },
          setStatus,
        );
        setStatus('saved');
        setKit({
          customised: brand?.customised ?? false,
          logo: brand?.tokens.logoLight ?? null,
          tokens: brand?.tokens ?? null,
        });
        setStarted(begun);
        setConversation(begun.conversation);
      })
      .catch(() => setFailed(true));
  }, [id, canChangeBrand]);

  /**
   * "Use these colours", pressed: the preset over the organisation's kit — its logo kept — or, with
   * no kit yet, its first one (owner question 8). The server takes it from an administrator only.
   */
  async function applyPreset(presetId: string): Promise<boolean> {
    const theme = presetById(presetId);
    if (!theme || !kit.tokens) return false;
    try {
      const saved = await client.saveBrandKit(withPreset(theme, kit.tokens));
      setKit({ customised: saved.customised, logo: saved.tokens.logoLight, tokens: saved.tokens });
      // The app, and with it the preview, is painted with the kit: now with these colours.
      repaint();
      return true;
    } catch {
      return false;
    }
  }

  useEffect(load, [load]);

  /** "Remember", pressed: stored, and read from the next thing typed on. */
  async function remember(offer: RememberAlias): Promise<Remembered> {
    try {
      const { alias } = await client.rememberAlias(offer);
      setLearned((known) => [...known.filter((a) => a.id !== alias.id), alias]);
      return { kind: 'remembered' };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'alias-refused') {
        const { reason, means } = error.detail as { reason?: AliasRefusalReason; means?: string };
        return {
          kind: 'refused',
          reason: reason ?? 'present',
          ...(typeof means === 'string' ? { means } : {}),
        };
      }
      return { kind: 'failed' };
    }
  }

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

  const notice =
    started.kind === 'resumed'
      ? started.rebased && 'conversation.rebased'
      : started.discarded === 'unreadable' && 'conversation.unreadable';

  return (
    <section className="stack">
      {notice && (
        <p className="conversation__started-again" role="status">
          {t(notice)}
        </p>
      )}
      <Shell
        graph={BUILDER_GRAPH}
        conversation={conversation}
        onChange={onChange}
        locales={{ interfaceLocale: locale, contentLocale }}
        contentLocales={locales}
        desktop={edition === 'desktop'}
        brand={{
          customised: kit.customised,
          logo: kit.logo,
          organisationName: organisation?.name ?? '',
        }}
        learning={{ aliases, remember }}
        templates={templates}
        colours={{ canChange: canChangeBrand, apply: applyPreset }}
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
