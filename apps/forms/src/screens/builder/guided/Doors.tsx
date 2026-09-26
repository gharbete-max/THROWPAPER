import { Icon } from '../../../components/Icon.js';
import { useT } from '../../../lib/i18n.js';

/**
 * The two doors — `PREDICTIVE-BUILDER.md`, "The two doors": after **New form**, two large cards and
 * nothing else. Start from questions opens the guided conversation; start from paper opens the
 * paper import on a new blank form. "Build it myself" — the classic route, with its templates and
 * its own link address — is not a third door but the way out every screen has.
 */
export function Doors({
  onQuestions,
  onPaper,
  onMyself,
  busy,
  error,
}: {
  onQuestions: () => void;
  onPaper: () => void;
  onMyself: () => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  return (
    <div className="card doors">
      <h2 className="doors__title">{t('conversation.doors.title')}</h2>
      <div className="doors__cards">
        <button
          type="button"
          className="conversation__card doors__door"
          disabled={busy}
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
