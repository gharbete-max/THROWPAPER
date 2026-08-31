import type { TokenSet } from './types.js';

/** Web target: CSS custom properties. Components consume variables only — CLAUDE.md rule 4. */
export function toCssVariables(tokens: TokenSet): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens.colour)) vars[`--tp-colour-${key}`] = value;
  for (const [key, value] of Object.entries(tokens.typography)) {
    vars[`--tp-type-${kebab(key)}`] = String(value);
  }
  vars['--tp-spacing-unit'] = tokens.spacingUnit;
  vars['--tp-radius'] = tokens.radius;
  vars['--tp-border-width'] = tokens.borderWidth;
  return vars;
}

export function toCssBlock(tokens: TokenSet, selector = ':root'): string {
  const body = Object.entries(toCssVariables(tokens))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
