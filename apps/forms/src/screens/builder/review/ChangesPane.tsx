import type { ImportChoices } from '@tp/shared/import';
import { useT } from '../../../lib/i18n.js';
import { documentText, formText, nothingChanged, type Update } from './reimport.js';

/**
 * "Compared with your form" — the document read again against the form made from it (S12c,
 * `docs/plan/CONVERGENCE.md`). What is new is listed and added; everything else is one decision
 * each, a toggle that starts off: nothing is taken out, reworded or moved without a press
 * (`CLAUDE.md` rule 7).
 */
export function ChangesPane({
  update,
  choices,
  onChoose,
  keepsPaper,
}: {
  update: Update;
  choices: ImportChoices;
  onChoose: (next: ImportChoices) => void;
  /** The form writes answers onto a paper: new questions are not on it, and the pane says so. */
  keepsPaper: boolean;
}) {
  const t = useT();
  const { comparison } = update;
  const flip = <K extends keyof ImportChoices>(key: K, value: ImportChoices[K][number]) => {
    const now = choices[key] as readonly (typeof value)[];
    onChoose({
      ...choices,
      [key]: now.includes(value) ? now.filter((v) => v !== value) : [...now, value],
    });
  };
  const toggle = <K extends keyof ImportChoices>(
    key: K,
    value: ImportChoices[K][number],
    label: string,
  ) => (
    <button
      type="button"
      className="review-chip"
      aria-pressed={(choices[key] as readonly (typeof value)[]).includes(value)}
      onClick={() => flip(key, value)}
    >
      {label}
    </button>
  );
  const shown = (text: string) => (text === '' ? '—' : text);

  if (nothingChanged(comparison)) {
    return (
      <section className="review-changes" aria-labelledby="review-changes-heading">
        <h2 id="review-changes-heading">{t('review.changes.heading')}</h2>
        <p>{t('review.changes.nothing')}</p>
      </section>
    );
  }
  return (
    <section className="review-changes" aria-labelledby="review-changes-heading">
      <h2 id="review-changes-heading">{t('review.changes.heading')}</h2>
      {comparison.added.length > 0 && (
        <div>
          <h3>{t('review.changes.added')}</h3>
          <ul>
            {comparison.added.map((index) => (
              <li key={index}>{shown(documentText(update, index))}</li>
            ))}
          </ul>
          {keepsPaper && <p className="small muted">{t('review.changes.noPaper')}</p>}
        </div>
      )}
      {comparison.addBack.length > 0 && (
        <div>
          <h3>{t('review.changes.addBack')}</h3>
          <ul>
            {comparison.addBack.map((index) => (
              <li key={index}>
                <span>{shown(documentText(update, index))}</span>
                {toggle('addBack', index, t('review.changes.addBackToggle'))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {comparison.reworded.length > 0 && (
        <div>
          <h3>{t('review.changes.reworded')}</h3>
          <ul>
            {comparison.reworded.map((index) => {
              const formId = comparison.matches[index]!.formId!;
              return (
                <li key={index}>
                  <span className="stack">
                    <span>
                      {t('review.changes.formSays', { text: shown(formText(update, formId)) })}
                    </span>
                    <span>
                      {t('review.changes.documentSays', {
                        text: shown(documentText(update, index)),
                      })}
                    </span>
                  </span>
                  {toggle('reword', index, t('review.changes.rewordToggle'))}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {comparison.gone.length > 0 && (
        <div>
          <h3>{t('review.changes.gone')}</h3>
          <ul>
            {comparison.gone.map((formId) => (
              <li key={formId}>
                <span>{shown(formText(update, formId))}</span>
                {toggle('remove', formId, t('review.changes.removeToggle'))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {comparison.moved.length > 0 && (
        <div>
          <h3>{t('review.changes.moved')}</h3>
          <ul>
            {comparison.moved.map((index) => (
              <li key={index}>
                <span>{shown(documentText(update, index))}</span>
                {toggle('move', index, t('review.changes.moveToggle'))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
