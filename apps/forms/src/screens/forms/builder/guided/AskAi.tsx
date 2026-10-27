import { useEffect, useMemo } from 'react';
import { needsAHuman, readDraft, type AiBridge, type DraftForm } from '@tp/shared/ai';
import { isSummaryLocale } from '@tp/shared/summary';
import { useT } from '../../../../lib/i18n.js';
import { useReplyJob } from '../../../send/reply-job.js';

/**
 * The AI's half of the Ask box: the local model drafts question labels, the person reads them, and
 * nothing is saved until "Use this form" (docs/plan/EASY.md, E4). The model's answer is checked
 * against the form schema (`readDraft`); a request about a contract, consent or the like is not
 * sent to it at all, because a person writes those words (CLAUDE.md rule 8).
 */
export function AskAi({
  bridge,
  request,
  locale,
  busy,
  onDraft,
  onRetry,
  onQuestions,
}: {
  bridge: AiBridge;
  request: string;
  /** The form's default language: the labels are written in it and stored under it. */
  locale: string;
  busy: boolean;
  onDraft: (draft: DraftForm) => void;
  onRetry: () => void;
  onQuestions: () => void;
}) {
  const t = useT();
  const { state, start, cancel } = useReplyJob(bridge);
  const refused = useMemo(() => needsAHuman(request), [request]);

  useEffect(() => {
    if (refused) return;
    void start({
      kind: 'draft-form',
      request,
      into: isSummaryLocale(locale) ? locale : 'en-GB',
    });
  }, [refused, request, locale, start]);

  const draft = state.phase === 'done' ? readDraft(state.text, locale) : null;
  const failed = refused || state.phase === 'failed' || (state.phase === 'done' && !draft);

  return (
    <div className="stack">
      {state.phase === 'running' && !refused && (
        <>
          <p>{t('ask.aiThinking')}</p>
          <div className="row">
            <button type="button" className="button button--quiet" onClick={cancel}>
              {t('ask.aiCancel')}
            </button>
          </div>
        </>
      )}
      {draft && (
        <>
          <p>{t('ask.aiIntro', { count: draft.fields.length })}</p>
          <ol className="ask__draft">
            {draft.fields.map((field) => (
              <li key={field.id}>{'label' in field ? field.label[locale] : ''}</li>
            ))}
          </ol>
          <div className="row">
            <button
              type="button"
              className="button"
              disabled={busy}
              autoFocus
              onClick={() => onDraft(draft)}
            >
              {t('ask.aiUse')}
            </button>
            <button type="button" className="button button--quiet" onClick={onRetry}>
              {t('ask.aiRetry')}
            </button>
          </div>
        </>
      )}
      {failed && (
        <>
          <p>
            {refused || state.problem === 'quote-only' ? t('ask.aiQuoteOnly') : t('ask.aiFailed')}
          </p>
          <div className="row">
            <button type="button" className="button" autoFocus onClick={onQuestions}>
              {t('ask.questions')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
