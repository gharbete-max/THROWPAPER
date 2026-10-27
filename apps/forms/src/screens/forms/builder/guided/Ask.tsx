import { useState, type FormEvent } from 'react';
import {
  ROUTE_PATHS,
  readAsk,
  type AskReading,
  type AskRoute,
  type FormTemplate,
} from '@tp/shared/forms';
import { useT } from '../../../../lib/i18n.js';

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
}: {
  templates: readonly FormTemplate[];
  /** A template's name in the interface language. */
  nameIn: (template: FormTemplate) => string;
  busy: boolean;
  onTemplate: (id: string) => void;
  onRoute: (path: string) => void;
  onQuestions: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [said, setSaid] = useState<{ words: string; reading: AskReading } | null>(null);
  const nameOf = (id: string) => {
    const template = templates.find((candidate) => candidate.id === id);
    return template ? nameIn(template) : id;
  };
  const routeName = (route: AskRoute) => t(`room.${route}`);

  function submit(event: FormEvent) {
    event.preventDefault();
    const words = text.trim();
    if (!words) return;
    setSaid({ words, reading: readAsk(words, templates) });
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
            autoFocus
            autoComplete="off"
            placeholder={t('ask.placeholder')}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="button" disabled={busy || !text.trim()}>
            {t('ask.go')}
          </button>
        </div>
      </form>
      {said && (
        <div className="ask__chat" aria-live="polite">
          <p className="ask__you">{said.words}</p>
          <div className="ask__loppa stack">
            {said.reading.kind === 'template' && (
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
            {said.reading.kind === 'route' && (
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
            {said.reading.kind === 'none' && (
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
