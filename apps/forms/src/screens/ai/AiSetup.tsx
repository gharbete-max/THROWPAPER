import { Link, useLocation } from 'react-router';
import { useT } from '../../lib/i18n.js';
import { useEdition } from '../../lib/edition.js';
import { aiBridge } from '../../lib/ai-bridge.js';
import { AddOns } from './AddOns.js';
import { ModelsPanel } from './summary/ModelsPanel.js';

/**
 * "Add-ons and updates": the one place inside the app for everything optional (ADR 0026, amended),
 * so nobody has to look for files online. It began as "Set up AI", one place for the model
 * (docs/plan/SIMPLIFY.md, proposal 1), and still opens with it; the program that runs the model,
 * the graphics-card program, the AI pack and the update check follow (`AddOns.tsx`).
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
      <h1>{t('addons.title')}</h1>
      <p>{t('addons.intro')}</p>
      <p>{t('ai.models.optional')}</p>
      {bridge ? (
        <>
          <ModelsPanel />
          <AddOns />
          <p>
            <Link className="link--target" to="/summary" state={state}>
              {t('room.centre')}
            </Link>
          </p>
        </>
      ) : (
        // No bridge: a browser or the hosted edition. Never wait on the server to say so.
        <>
          <p>{edition === 'desktop' ? t('room.centreLater') : t('ai.setup.desktopOnly')}</p>
          <AddOns />
        </>
      )}
    </section>
  );
}
