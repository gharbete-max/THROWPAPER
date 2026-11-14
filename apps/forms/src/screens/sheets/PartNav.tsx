import { Link } from 'react-router';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../lib/i18n.js';

/** The way back to the room, and between the Spreadsheets parts that exist (ADR 0027). */
export function PartNav({ current }: { current: 'library' | 'convert' }) {
  const t = useT();
  return (
    <nav className="sheets__nav" aria-label={t('room.spreadsheets')}>
      <Link className="button button--bare small" to="/room">
        <Icon name="arrow-left" className="icon--lead" />
        {t('room.back')}
      </Link>
      <Link
        className="button button--quiet small"
        to="/sheets"
        {...(current === 'library' ? { 'aria-current': 'page' as const } : {})}
      >
        {t('sheets.library')}
      </Link>
      <Link
        className="button button--quiet small"
        to="/sheets/convert"
        {...(current === 'convert' ? { 'aria-current': 'page' as const } : {})}
      >
        {t('sheets.convert')}
      </Link>
    </nav>
  );
}
