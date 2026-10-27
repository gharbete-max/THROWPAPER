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
    <div className="doors">
      <Ask
        templates={templates}
        nameIn={nameIn}
        busy={busy}
        onTemplate={onTemplate}
        onRoute={onRoute}
        onQuestions={onQuestions}
        locale={locale}
        onDraft={onDraft}
        focusInput={focus === undefined}
      />
      {error && <p className="status-down small">{error}</p>}
      <div className="doors__links">
        <button
          type="button"
          className="button button--bare small doors__door"
          disabled={busy}
          autoFocus={focus === 'questions'}
          onClick={onQuestions}
        >
          <Icon name="single_select" className="icon--lead" />
          {t('conversation.doors.questions')}
        </button>
        <button
          type="button"
          className="button button--bare small doors__door"
          disabled={busy}
          autoFocus={focus === 'paper'}
          onClick={onPaper}
        >
          <Icon name="file" className="icon--lead" />
          {t('conversation.doors.paper')}
        </button>
        <span className="doors__myself">
          <button type="button" className="button button--bare small" onClick={onMyself}>
            {t('wizard.advanced')}
          </button>
        </span>
      </div>
    </div>
  );
}
