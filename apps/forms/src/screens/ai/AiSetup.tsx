import { Link, useLocation } from 'react-router';
import { useT } from '../../lib/i18n.js';
import { useEdition } from '../../lib/edition.js';
import { aiBridge } from '../../lib/ai-bridge.js';
import { ModelsPanel } from './summary/ModelsPanel.js';

/**
 * "Set up AI": one place for the model (docs/plan/SIMPLIFY.md, proposal 1).
 *
 * The default view is one model that suits this computer and one button; the other models, the
 * graphics card, the program that runs them and the folders sit behind two disclosures. The work
 * screens (Summary, the AI reader, the reply helper) only say whether a model is ready and link
 * here. AI is optional and says so first: nothing is downloaded unless the person presses
 * Download and confirms.
 */
export function AiSetup() {
  const t = useT();
  const edition = useEdition();
  const bridge = aiBridge();
  // A document handed over from Scan travels there and back, in memory.
  const state = useLocation().state;
  return (
    <section className="stack">
      <h1>{t('ai.setup.title')}</h1>
      <p>{t('ai.models.optional')}</p>
      {bridge ? (
        <>
          <ModelsPanel />
          <p>
            <Link to="/summary" state={state}>
              {t('room.centre')}
            </Link>
          </p>
        </>
      ) : (
        // No bridge: a browser or the hosted edition. Never wait on the server to say so.
        <p>{edition === 'desktop' ? t('room.centreLater') : t('ai.setup.desktopOnly')}</p>
      )}
    </section>
  );
}
