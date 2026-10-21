import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../../lib/session.js';
import { useT } from '../../../lib/i18n.js';
import { scanWith } from '../../../lib/documents-handoff.js';
import { sizeText } from '../../../lib/keep-size.js';
import { loadRecent, saveRecent, type Recent } from '../../../lib/recent-docs.js';
import { useConfirm } from '../../../components/Confirm.js';
import { Icon } from '../../../components/Icon.js';

/**
 * The room's list of recent documents, beside the catchers. Names only, kept in this browser
 * (`lib/recent-docs.ts`); a name opens nothing by itself, because the file is not kept, so it asks
 * for the file again. "Open a file" is the keyboard's way to what a drop does with a mouse.
 */
export function RecentDocuments() {
  const t = useT();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user, locale } = useSession();
  const userId = user?.id ?? '';
  const [list, setList] = useState<Recent[]>(() => loadRecent(userId));
  const picker = useRef<HTMLInputElement>(null);

  async function clear() {
    const agreed = await confirm(t('docs.recent.clearAsk'), {
      confirmLabel: t('docs.recent.clearYes'),
      danger: true,
    });
    if (!agreed) return;
    saveRecent(userId, []);
    setList([]);
  }

  return (
    <section className="recent" aria-labelledby="recent-heading">
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        data-testid="room-files"
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = '';
          if (chosen.length > 0) void navigate(...scanWith(chosen));
        }}
      />
      <h2 id="recent-heading" className="recent__title">
        {t('docs.recent.heading')}
      </h2>
      <p className="recent__note small">{t('docs.drop.hint')}</p>
      <button type="button" className="button small" onClick={() => picker.current?.click()}>
        <Icon name="upload" className="icon--lead" />
        {t('docs.open')}
      </button>
      {list.length === 0 ? (
        <p className="recent__note small">{t('docs.recent.empty')}</p>
      ) : (
        <>
          <ul className="recent__list">
            {list.map((item) => (
              <li key={`${item.name}:${item.size}`}>
                <button
                  type="button"
                  className="recent__item"
                  aria-label={t('docs.recent.again', { name: item.name })}
                  onClick={() => picker.current?.click()}
                >
                  <span className="recent__name">{item.name}</span>
                  <span className="recent__meta small">
                    {t(`docs.k.${item.kind}`)} · {sizeText(item.size, locale)} ·{' '}
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                      new Date(item.at),
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="recent__note small">{t('docs.recent.note')}</p>
          <button type="button" className="button button--quiet small" onClick={() => void clear()}>
            {t('docs.recent.clear')}
          </button>
        </>
      )}
    </section>
  );
}
