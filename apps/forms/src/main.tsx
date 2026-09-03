import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';
import { App } from './App.js';
import { initTheme } from './lib/theme.js';
import './styles.css';

// Rule 4: no hard-coded colours, fonts or spacing. Everything below reads these variables.
// `toThemedCssBlock` emits the light palette and the derived dark one together, so the app has a
// dark mode before it has a session.
const style = document.createElement('style');
style.textContent = toThemedCssBlock(defaultTokens);
document.head.appendChild(style);

// Before the first render, or the page paints light and then flips.
initTheme();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
