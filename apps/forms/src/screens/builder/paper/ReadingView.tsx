import { useT } from '../../../lib/i18n.js';
import { Icon } from '../../../components/Icon.js';
import { readingFile, type Reading } from './reading.js';

/**
 * What the import read from a document, before anything becomes a question — the M4 demo in
 * `docs/plan/ROADMAP.md`: a two-column PDF and a Word file with real numbering read in order, and
 * what was read downloadable.
 *
 * It shows the numbered items in reading order, each at its level, and says plainly that nothing
 * has changed. The review screen, where items become questions, is S10; until then this is a
 * reading, not an import. The download is everything the stages decided, built here in the
 * browser: it is never sent to the server (`CAVEATS.md` #43).
 */
export function ReadingView({ name, reading }: { name: string; reading: Reading }) {
  const t = useT();
  const lines = reading.layout.pages.reduce(
    (n, page) => n + page.blocks.reduce((m, block) => m + block.lines.length, 0),
    0,
  );
  const items = reading.lists.items;

  function download() {
    const blob = new Blob([readingFile(reading)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, '') || 'reading'}.reading.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className="stack small import__reading"
      aria-label={`${t('paper.read.heading')}: ${name}`}
    >
      <div className="row row--between">
        <strong>
          {t('paper.read.heading')} — {name}
        </strong>
        <span className="muted">
          {t('paper.read.lines', { count: lines })} ·{' '}
          {t('paper.read.items', { count: items.length })}
        </span>
      </div>
      {lines === 0 ? (
        <span className="muted">{t('paper.read.noText')}</span>
      ) : (
        items.length > 0 && (
          <ol className="import__items">
            {items.map((item) => (
              <li
                key={item.id}
                className="import__item"
                style={{
                  paddingInlineStart: `calc(var(--tp-spacing-unit) * ${2 * (item.level - 1)})`,
                }}
              >
                <span className="import__marker">{item.marker.raw}</span> {item.label}
              </li>
            ))}
          </ol>
        )
      )}
      <p className="muted">{t('paper.read.unchanged')}</p>
      <div className="row">
        <button type="button" className="button button--quiet" onClick={download}>
          <Icon name="download" />
          {t('paper.read.download')}
        </button>
      </div>
    </section>
  );
}
