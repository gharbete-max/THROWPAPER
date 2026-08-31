import { toCssBlock, type TokenSet } from '@tp/tokens';
import { proofCard, NORDIC_PROBE, type ProofCard } from './card.js';

/** Web target: everything reads CSS custom properties, nothing hard-codes a colour. */
export function renderWeb(tokens: TokenSet, card: ProofCard = proofCard): string {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<title>Web target</title>
<style>
${toCssBlock(tokens)}
body {
  margin: 0;
  padding: 24px;
  background: var(--tp-colour-surface);
  color: var(--tp-colour-text);
  font-family: var(--tp-type-body-font);
  font-size: var(--tp-type-base-size);
  line-height: var(--tp-type-line-height);
}
.card {
  max-width: 600px;
  background: var(--tp-colour-background);
  border: var(--tp-border-width) solid var(--tp-colour-border);
  border-radius: var(--tp-radius);
  padding: calc(var(--tp-spacing-unit) * 3);
}
.eyebrow {
  margin: 0 0 calc(var(--tp-spacing-unit) * 1);
  color: var(--tp-colour-muted);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
h1 {
  margin: 0 0 var(--tp-spacing-unit);
  font-family: var(--tp-type-heading-font);
  font-weight: var(--tp-type-weight-bold);
  color: var(--tp-colour-primary);
}
p { margin: 0 0 calc(var(--tp-spacing-unit) * 2); }
.meta { color: var(--tp-colour-muted); }
.button {
  display: inline-block;
  padding: calc(var(--tp-spacing-unit) * 1.5) calc(var(--tp-spacing-unit) * 3);
  border-radius: var(--tp-radius);
  background: var(--tp-colour-primary);
  color: var(--tp-colour-background);
  font-weight: var(--tp-type-weight-bold);
  text-decoration: none;
}
.footer { margin-top: calc(var(--tp-spacing-unit) * 3); color: var(--tp-colour-muted); font-size: 13px; }
</style>
</head>
<body>
<div class="card">
  <p class="eyebrow">${card.eyebrow}</p>
  <h1>${card.title}</h1>
  <p>${card.body}</p>
  <p class="meta">${card.meta}</p>
  <a class="button" href="${card.buttonHref}">${card.buttonLabel}</a>
  <p class="footer">${card.footer} · ${NORDIC_PROBE}</p>
</div>
</body>
</html>
`;
}
