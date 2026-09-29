import { useEffect, useMemo, useRef } from 'react';
import type { LocaleConfig } from '@tp/i18n';
import { emptyDefinition, type FieldType } from '@tp/shared/forms';
import type { Kind, StageDebug } from '@tp/shared/import';
import { useT } from '../../../lib/i18n.js';
import { FormPreview } from '../FormPreview.js';
import { fieldsOf, fieldTypeOf } from './fields.js';
import { asks, type Action, type Review, type ReviewItem, refusal } from './review.js';

/** A type's name: the field type's own, or the review's for a kind the form has no field for. */
export function kindName(kind: Kind): string {
  return fieldTypeOf(kind) === kind ? `fieldType.${kind as FieldType}` : `review.type.${kind}`;
}

/**
 * The form as the document was read — `IMPORT-PIPELINE.md` §8, "the draft on the right as real
 * previews": every question as the control it will become (`FormPreview`, the public page's own
 * `FieldInput`), headings and text as they will read. Each item says how sure the reading is; the
 * ones Loppa is not sure of carry their chips; the selected one carries the actions and "Why?".
 */
export function DraftPane({
  review,
  debug,
  selectedId,
  onSelect,
  onAct,
  locale,
  locales,
}: {
  review: Review;
  /** The stages' decisions, for "Why?". */
  debug: readonly StageDebug[];
  selectedId: string | null;
  onSelect: (itemId: string) => void;
  onAct: (action: Action) => void;
  locale: string;
  locales: LocaleConfig;
}) {
  const t = useT();
  const list = useRef<HTMLOListElement>(null);
  const previews = useMemo(
    () =>
      new Map(
        review.items.filter(asks).map((item) => [
          item.id,
          {
            ...emptyDefinition,
            fields: fieldsOf([item], { definition: emptyDefinition, retired: [], locale }),
          },
        ]),
      ),
    [review.items, locale],
  );

  // The selected item into view, and focused, so the keys and a screen reader are both on it.
  useEffect(() => {
    if (!selectedId || !list.current) return;
    const element = list.current.querySelector<HTMLElement>(
      `[data-item="${CSS.escape(selectedId)}"]`,
    );
    element?.scrollIntoView({ block: 'nearest' });
    if (element && !element.contains(document.activeElement))
      element.focus({ preventScroll: true });
  }, [selectedId]);

  return (
    <section className="review-draft" aria-label={t('review.draft')}>
      <ol className="review-draft__items" ref={list}>
        {review.items.map((item) => {
          const selected = item.id === selectedId;
          const state = item.decided ? 'settled' : item.bucket;
          const preview = previews.get(item.id);
          return (
            <li
              key={item.id}
              data-item={item.id}
              className={`review-item review-item--${state}${selected ? ' review-item--selected' : ''}`}
              aria-current={selected ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(item.id)}
              // Only when the item itself takes focus: a chip or button inside it selects the item
              // when pressed. Selecting on its focus would move the list under the pointer before
              // the press ended (the actions leave the item that was selected), and lose the press.
              onFocus={(event) => {
                if (event.target === event.currentTarget) onSelect(item.id);
              }}
            >
              <div className="review-item__head">
                <span className="review-item__kind">{t(`review.kind.${item.kind}`)}</span>
                <span className={`review-item__bucket review-item__bucket--${state}`}>
                  {item.decided ? t('review.settled') : t(`review.bucket.${item.bucket}`)}
                </span>
                {item.field && <span className="small muted">{t('review.formField')}</span>}
                {item.required && <span className="small muted">{t('review.required')}</span>}
              </div>

              {preview ? (
                <div className="review-item__preview">
                  {item.text === '' && item.kind === 'question' && (
                    <p className="small status-warning">{t('review.noLabel')}</p>
                  )}
                  <FormPreview
                    definition={preview}
                    locale={locale}
                    locales={locales}
                    selectedId={null}
                    note={false}
                  />
                </div>
              ) : item.kind === 'heading' ? (
                <h2 className="review-item__heading">{item.text}</h2>
              ) : (
                <p className="review-item__text">{item.text}</p>
              )}

              {item.alternatives.length > 0 && (
                <div className="review-item__chips">
                  {!item.decided && <p className="small">{t('review.guessed')}</p>}
                  <div className="row" role="group" aria-label={t('review.guessed')}>
                    {item.alternatives.map((kind, index) => (
                      <button
                        key={kind}
                        type="button"
                        className="review-chip"
                        aria-pressed={item.type === kind}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(item.id);
                          onAct({ kind: 'pick', itemId: item.id, type: kind });
                        }}
                      >
                        <span className="review-chip__key" aria-hidden="true">
                          {index + 1}
                        </span>
                        {t(kindName(kind))}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selected && <Actions item={item} review={review} onAct={onAct} debug={debug} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Accept, merge, split, and what kind it is — each offered only where it can be done. */
function Actions({
  item,
  review,
  onAct,
  debug,
}: {
  item: ReviewItem;
  review: Review;
  onAct: (action: Action) => void;
  debug: readonly StageDebug[];
}) {
  const t = useT();
  const offer = (action: Action, label: string, key: string) =>
    refusal(review, action) === null ? (
      <button
        type="button"
        className="button button--quiet"
        aria-keyshortcuts={key}
        onClick={(event) => {
          event.stopPropagation();
          onAct(action);
        }}
      >
        {t(label)}
      </button>
    ) : null;
  const why = debug.flatMap((stage) =>
    stage.decisions
      .filter((decision) => decision.subject.some((line) => item.lineIds.includes(line)))
      .map((decision) => ({ stage: stage.stage, rule: decision.rule, verdict: decision.verdict })),
  );

  return (
    <div className="review-item__actions">
      <div className="row">
        {offer({ kind: 'accept', itemId: item.id }, 'review.accept', 'Enter')}
        {offer({ kind: 'merge', itemId: item.id }, 'review.merge', 'M')}
        {offer({ kind: 'split', itemId: item.id, at: 1 }, 'review.split', 'S')}
        {offer({ kind: 'text', itemId: item.id }, 'review.justText', 'T')}
        {offer({ kind: 'question', itemId: item.id }, 'review.makeQuestion', 'Q')}
      </div>
      {why.length > 0 && (
        <details className="small" onClick={(event) => event.stopPropagation()}>
          <summary>{t('review.why')}</summary>
          <ul className="review-item__why">
            {why.map((line, index) => (
              <li key={index}>
                {t('review.whyLine', {
                  stage: line.stage,
                  rule: line.rule,
                  verdict: String(line.verdict),
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
