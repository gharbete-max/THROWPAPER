import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { useT } from '../../lib/i18n.js';
import { useEdition } from '../../lib/edition.js';
import { modelBridge } from '../../lib/model-bridge.js';
import { scanWith } from '../../lib/documents-handoff.js';
import { PART_STYLE } from '../../lib/part-style.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { RecentDocuments } from './documents/RecentDocuments.js';
import { AiHint } from './AiHint.js';

/**
 * Home: where a signed-in person arrives (`docs/plan/EASY.md`, E1; it replaces the room of ADR
 * 0022). Four big coloured tiles, each a verb and one line, and nothing else to choose from. The
 * other two catchers are named once, quietly, and are not controls: something that does nothing
 * must not look like it can be pressed (`room.spec.ts` holds that).
 *
 * Documents dropped anywhere on the page go to Scan, which tells each file apart by its bytes.
 */
export function Home() {
  const t = useT();
  const edition = useEdition();
  const navigate = useNavigate();
  const centre = edition === 'desktop' && modelBridge();

  return (
    <div
      className="home"
      style={PART_STYLE}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const dropped = [...event.dataTransfer.files];
        if (dropped.length === 0) return;
        event.preventDefault();
        void navigate(...scanWith(dropped));
      }}
    >
      <h1 className="home__title">{t('home.title')}</h1>
      {centre ? <AiHint /> : null}
      <ul className="home__tiles">
        <Tile part="forms" to="/forms" icon="forms" />
        <Tile part="scan" to="/scan" icon="upload" />
        <Tile part="sign" to="/signing" icon="signature" />
        <Tile part="send" to="/send" icon="email" />
      </ul>
      {centre ? (
        <Link className="home__centre" to="/summary">
          <strong>{t('room.centre')}</strong>
          <span>{t('room.centreOpen')}</span>
        </Link>
      ) : null}
      {centre ? (
        <Link className="button button--quiet small" to="/ai-setup">
          {t('addons.title')}
        </Link>
      ) : null}
      <RecentDocuments />
      <p className="home__later small">
        {t('room.spreadsheets')} · {t('room.presentation')} — {t('room.notBuilt')}
      </p>
    </div>
  );
}

function Tile({
  part,
  to,
  icon,
}: {
  part: 'forms' | 'scan' | 'sign' | 'send';
  to: string;
  icon: IconName;
}) {
  const t = useT();
  const colours = {
    '--tile': `var(--tp-part-${part})`,
    '--tile-ink': `var(--tp-part-${part}-ink)`,
  } as CSSProperties;
  return (
    <li>
      <Link className="tile" to={to} style={colours}>
        <Icon name={icon} className="tile__icon" />
        <strong className="tile__name">{t(`home.${part}`)}</strong>
        <span className="tile__hint">{t(`home.${part}Hint`)}</span>
      </Link>
    </li>
  );
}
