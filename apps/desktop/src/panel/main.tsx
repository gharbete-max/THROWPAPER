import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';
import { Panel } from './Panel.js';
import { messagesFor } from '../messages.js';
import type { LoppaBridge } from '../bridge.js';
import './styles.css';

declare global {
  interface Window {
    loppa: LoppaBridge;
  }
}

// Rule 4: no hard-coded colours, fonts or spacing. Everything in styles.css reads these variables.
const style = document.createElement('style');
style.textContent = toThemedCssBlock(defaultTokens);
document.head.appendChild(style);

const state = await window.loppa.state();
const { lang, t } = messagesFor([state.lang]);
document.documentElement.lang = lang;
document.title = state.view === 'setup' ? t.setupTitle : t.settingsTitle;

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Panel t={t} initial={state} bridge={window.loppa} />
  </StrictMode>,
);
