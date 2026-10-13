import { useT } from '../../lib/i18n.js';

export interface OpenedAs {
  /** Which sentence says what the file was taken for. */
  kind: 'pdf' | 'word' | 'photo' | 'several';
  /** Set when the PDF has fields of its own: offered, never done unasked. */
  fill: (() => void) | null;
  /** Other things the file could have been opened as. */
  choices: Array<{ key: 'fill' | 'invoice'; run: () => void }>;
}

/**
 * Says what a dropped file was taken for, every time, and offers the other ways to open it. A
 * file is never routed silently: the sentence stays until the next one replaces it.
 */
export function OpenedNotice({ opened }: { opened: OpenedAs }) {
  const t = useT();
  return (
    <div className="scan__notice stack stack--tight" role="status" data-testid="opened-notice">
      <p>{t(`docs.opened.${opened.kind}`)}</p>
      {opened.fill ? (
        <p className="scan__bar">
          <span>{t('docs.fillOffer')}</span>
          <button type="button" className="button" data-testid="opened-fill" onClick={opened.fill}>
            {t('docs.fill')}
          </button>
        </p>
      ) : null}
      {opened.choices.length > 0 ? (
        <details>
          <summary>{t('docs.choose')}</summary>
          <div className="scan__bar">
            {opened.choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                className="button button--quiet"
                onClick={choice.run}
              >
                {t(choice.key === 'fill' ? 'docs.as.fill' : 'docs.as.invoice')}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
