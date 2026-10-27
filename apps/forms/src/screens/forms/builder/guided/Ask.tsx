import { useEffect, useState, type FormEvent } from 'react';
import {
  ROUTE_PATHS,
  readAsk,
  type AskReading,
  type AskRoute,
  type FormTemplate,
} from '@tp/shared/forms';
import type { DraftForm } from '@tp/shared/ai';
import { aiBridge } from '../../../../lib/ai-bridge.js';
import { useT } from '../../../../lib/i18n.js';
import { AskAi } from './AskAi.js';

/**
 * "What do you want to make?" — the first thing on New form: a box and a short chat, not a
 * catalogue (`docs/plan/EASY.md`). A few words are read by rule (`readAsk`) as a template or as
 * another part of the app, and Loppa answers with one thing to press. Nothing is made until a press.
 */
export function Ask({
  templates,
  nameIn,
  busy,
  onTemplate,
  onRoute,
  onQuestions,
  locale,
  onDraft,
  focusInput = true,
}: {
  templates: readonly FormTemplate[];
  /** A template's name in the interface language. */
  nameIn: (template: FormTemplate) => string;
  busy: boolean;
  onTemplate: (id: string) => void;
  onRoute: (path: string) => void;
  onQuestions: () => void;
  /** The form's default language, for a draft by the AI. */
  locale: string;
  onDraft: (draft: DraftForm) => void;
  /** False when another start was asked for by the address and holds the focus. */
  focusInput?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [said, setSaid] = useState<{ words: string; reading: AskReading; run: number } | null>(
    null,
  );
  // The AI switch exists only where a text model is installed (desktop); off until pressed.
  const bridge = aiBridge();
  const [aiReady, setAiReady] = useState(false);
  const [ai, setAi] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    void bridge
      .status()
      .then((status) =>
        setAiReady(
          status.models.some(
            (model) =>
              model.available &&
              model.capabilities.includes('text') &&
              (model.state === 'installed' || model.state === 'busy'),
          ),
        ),
      )
      .catch(() => setAiReady(false));
  }, [bridge]);
  const nameOf = (id: string) => {
    const template = templates.find((candidate) => candidate.id === id);
    return template ? nameIn(template) : id;
  };
  const routeName = (route: AskRoute) => t(`room.${route}`);

  function submit(event: FormEvent) {
    event.preventDefault();
    const words = text.trim();
    if (!words) return;
    setSaid({ words, reading: readAsk(words, templates), run: (said?.run ?? 0) + 1 });
  }

  return (
    <div className="ask">
      <form className="ask__form" onSubmit={submit}>
        <label className="ask__label" htmlFor="ask-input">
          {t('ask.label')}
        </label>
        <div className="ask__row">
          <input
            id="ask-input"
            className="ask__input"
            value={text}
            autoFocus={focusInput}
            autoComplete="off"
            placeholder={t('ask.placeholder')}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="button" disabled={busy || !text.trim()}>
            {t('ask.go')}
          </button>
        </div>
        {bridge && aiReady && (
          <label className="ask__ai">
            <input
              type="checkbox"
              role="switch"
              checked={ai}
              onChange={(event) => {
                setAi(event.target.checked);
                setSaid(null);
              }}
            />
            {t('ask.ai')}
          </label>
        )}
      </form>
      {said && (
        <div className="ask__chat" aria-live="polite">
          <p className="ask__you">{said.words}</p>
          <div className="ask__loppa stack">
            {ai && bridge && (
              <AskAi
                key={said.run}
                bridge={bridge}
                request={said.words}
                locale={locale}
                busy={busy}
                onDraft={onDraft}
                onRetry={() => setSaid({ ...said, run: said.run + 1 })}
                onQuestions={onQuestions}
              />
            )}
            {!ai && said.reading.kind === 'template' && (
              <>
                <p>{t('ask.found', { name: nameOf(said.reading.ids[0]!) })}</p>
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    autoFocus
                    onClick={() =>
                      onTemplate(said.reading.kind === 'template' ? said.reading.ids[0]! : '')
                    }
                  >
                    {t('ask.use', { name: nameOf(said.reading.ids[0]!) })}
                  </button>
                  {said.reading.ids.slice(1).map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="button button--quiet"
                      disabled={busy}
                      onClick={() => onTemplate(id)}
                    >
                      {nameOf(id)}
                    </button>
                  ))}
                  <button type="button" className="button button--bare" onClick={onQuestions}>
                    {t('ask.questions')}
                  </button>
                </div>
              </>
            )}
            {!ai && said.reading.kind === 'route' && (
              <>
                <p>{t('ask.route', { name: routeName(said.reading.route) })}</p>
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    autoFocus
                    onClick={() =>
                      onRoute(said.reading.kind === 'route' ? ROUTE_PATHS[said.reading.route] : '/')
                    }
                  >
                    {t('ask.open', { name: routeName(said.reading.route) })}
                  </button>
                </div>
              </>
            )}
            {!ai && said.reading.kind === 'none' && (
              <>
                <p>{t('ask.unsure')}</p>
                <div className="row">
                  <button type="button" className="button" autoFocus onClick={onQuestions}>
                    {t('ask.questions')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
