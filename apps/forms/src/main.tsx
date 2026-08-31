import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultTokens, toCssBlock } from '@tp/tokens';
import { App } from './App.js';
import './styles.css';

// Rule 4: no hard-coded colours, fonts or spacing. Everything below reads these variables.
const style = document.createElement('style');
style.textContent = toCssBlock(defaultTokens);
document.head.appendChild(style);

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
