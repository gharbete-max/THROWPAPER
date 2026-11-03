import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { needsAHuman, readDraft, type AiBridge } from '@tp/shared/ai';
import { isSummaryLocale } from '@tp/shared/summary';
import type { Field } from '@tp/shared/forms';
import { aiBridge } from '../../../lib/ai-bridge.js';
import { useT } from '../../../lib/i18n.js';
import { Icon } from '../../../components/Icon.js';
import { useReplyJob } from '../../send/reply-job.js';

/**
 * A small chat at the bottom of the editor: say what to add, read what the local model proposes,
 * press Add. Nothing reaches the form until Add, and Add is one Undo (`docs/plan/EASY.md`, E4).
 *
 * It is the draft-form task of the AI centre (`@tp/shared/ai`): labels and plain question types
 * only, checked against the form schema, and a request about a contract, consent or the like is
 * not sent to the model at all, because a person writes those words (CLAUDE.md rule 8). Only the
 * desktop has a model; elsewhere there is no chat bar, rather than one that does nothing.
 */
export function ChatBar({
  locale,
  onAdd,
}: {
  /** The form's default language: the labels are written in it and stored under it. */
  locale: string;
  onAdd: (fields: Field[]) => void;
}) {
  const bridge = aiBridge();
  return bridge ? <Chat bridge={bridge} locale={locale} onAdd={onAdd} /> : null;
}

function Chat({
  bridge,
  locale,
  onAdd,
}: {
  bridge: AiBridge;
  locale: string;
  onAdd: (fields: Field[]) => void;
}) {
  const t = useT();
  const { state, start, cancel, reset } = useReplyJob(bridge);
  const [ready, setReady] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [refused, setRefused] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void bridge
      .status()
      .then((status) =>
        setReady(
          status.models.some(
            (model) =>
              model.available &&
              model.capabilities.includes('text') &&
              (model.state === 'installed' || model.state === 'busy'),
          ),
        ),
      )
      .catch(() => setReady(false));
  }, [bridge]);

  const draft = state.phase === 'done' ? readDraft(state.text, locale) : null;
  const running = state.phase === 'running';
  const failed = refused || state.phase === 'failed' || (state.phase === 'done' && !draft);
  const chosen = draft ? draft.fields.filter((field) => !left.has(field.id)) : [];

  function ask(event: FormEvent) {
    event.preventDefault();
    const request = text.trim();
    if (!request || running) return;
    reset();
    setLeft(new Set());
    const human = needsAHuman(request);
    setRefused(human);
    if (human) return;
    void start({ kind: 'draft-form', request, into: isSummaryLocale(locale) ? locale : 'en-GB' });
  }

  function close() {
    reset();
    setRefused(false);
    setText('');
  }

  return (
    <section className="chat" aria-label={t('chat.label')}>
      <div role="status" aria-live="polite">
        {running && <p className="small">{t('ask.aiThinking')}</p>}
        {failed && (
          <p className="small">
            {refused || state.problem === 'quote-only' ? t('ask.aiQuoteOnly') : t('chat.failed')}
          </p>
        )}
        {draft && (
          <fieldset className="chat__draft">
            <legend className="small">{t('chat.proposal', { count: draft.fields.length })}</legend>
            {draft.fields.map((field) => (
              <label key={field.id} className="chat__pick">
                <input
                  type="checkbox"
                  checked={!left.has(field.id)}
                  onChange={(event) =>
                    setLeft((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(field.id);
                      else next.add(field.id);
                      return next;
                    })
                  }
                />
                {'label' in field ? field.label[locale] : ''}
              </label>
            ))}
            <div className="row">
              <button
                type="button"
                className="button"
                disabled={chosen.length === 0}
                onClick={() => {
                  onAdd(chosen);
                  close();
                }}
              >
                {t('chat.add', { count: chosen.length })}
              </button>
              <button type="button" className="button button--quiet" onClick={close}>
                {t('chat.no')}
              </button>
            </div>
          </fieldset>
        )}
      </div>
      {ready === false ? (
        <p className="small chat__setup">
          <Link to="/ai-setup">{t('chat.setup')}</Link>
        </p>
      ) : (
        <form className="chat__row" onSubmit={ask}>
          <input
            className="chat__input"
            value={text}
            maxLength={400}
            autoComplete="off"
            aria-label={t('chat.label')}
            placeholder={t('chat.placeholder')}
            disabled={ready === null}
            onChange={(event) => setText(event.target.value)}
          />
          {running ? (
            <button type="button" className="button button--quiet" onClick={cancel}>
              {t('ask.aiCancel')}
            </button>
          ) : (
            <button
              type="submit"
              className="button button--icon"
              disabled={!text.trim() || ready === null}
              aria-label={t('chat.send')}
              title={t('chat.send')}
            >
              <Icon name="arrow-right" />
            </button>
          )}
        </form>
      )}
    </section>
  );
}
