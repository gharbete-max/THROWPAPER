import type { DraftForm } from '@tp/shared/ai';
import type { FormTemplate } from '@tp/shared/forms';
import { Icon } from '../../../../components/Icon.js';
import { useT } from '../../../../lib/i18n.js';
import { Ask } from './Ask.js';

/**
 * The two doors — `PREDICTIVE-BUILDER.md`, "The two doors": after **New form**, two large cards and
 * nothing else. Start from questions opens the guided conversation; start from paper opens the
 * review screen (S10) for a new blank form. "Build it myself" — the classic route, with its templates and
 * its own link address — is not a third door but the way out every screen has.
 */
export function Doors({
  templates,
  nameIn,
  onTemplate,
  onRoute,
  onDraft,
  locale,
  onQuestions,
  onPaper,
  onMyself,
  busy,
  error,
  focus,
}: {
  templates: readonly FormTemplate[];
  nameIn: (template: FormTemplate) => string;
  onTemplate: (id: string) => void;
  onRoute: (path: string) => void;
  onDraft: (draft: DraftForm) => void;
  locale: string;
  onQuestions: () => void;
  onPaper: () => void;
  onMyself: () => void;
  busy: boolean;
  error: string | null;
  /** The door under focus on arrival, when the address names one. */
  focus?: 'questions' | 'paper';
}) {
  const t = useT();
  return (
    <div className="card doors">
      <Ask
        templates={templates}
        nameIn={nameIn}
        busy={busy}
        onTemplate={onTemplate}
        onRoute={onRoute}
        onQuestions={onQuestions}
        locale={locale}
        onDraft={onDraft}
      />
      <div className="doors__cards">
        <button
          type="button"
          className="conversation__card doors__door"
          disabled={busy}
          autoFocus={focus === 'questions'}
          onClick={onQuestions}
        >
          <Icon name="single_select" />
          <span className="conversation__card-text">
            <strong>{t('conversation.doors.questions')}</strong>
            <span className="conversation__detail">{t('conversation.doors.questionsDetail')}</span>
          </span>
        </button>
        <button
          type="button"
          className="conversation__card doors__door"
          disabled={busy}
          autoFocus={focus === 'paper'}
          onClick={onPaper}
        >
          <Icon name="file" />
          <span className="conversation__card-text">
            <strong>{t('conversation.doors.paper')}</strong>
            <span className="conversation__detail">{t('conversation.doors.paperDetail')}</span>
          </span>
        </button>
      </div>
      {error && <p className="status-down small">{error}</p>}
      <div className="doors__myself">
        <button type="button" className="button button--bare" onClick={onMyself}>
          {t('wizard.advanced')}
        </button>
      </div>
    </div>
  );
}
