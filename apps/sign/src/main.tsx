import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';
import { App } from './App.js';
import { translatorFor } from './messages.js';
import './styles.css';

// Rule 4: no hard-coded colours, fonts or spacing. Everything below reads these variables.
const style = document.createElement('style');
style.textContent = toThemedCssBlock(defaultTokens);
document.head.appendChild(style);

const { lang, t } = translatorFor(navigator.languages);
document.documentElement.lang = lang;

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App t={t} />
  </StrictMode>,
);
