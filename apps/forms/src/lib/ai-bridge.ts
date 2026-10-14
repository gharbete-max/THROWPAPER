import type { AiBridge } from '@tp/shared/ai';

declare global {
  interface Window {
    /** The desktop shell's bridge to the AI coordinator. Absent in a browser and on a server. */
    loppaAi?: AiBridge;
  }
}

/**
 * The AI coordinator's bridge, or null where this edition has none (ADR 0024).
 *
 * Only the desktop app's preload defines `window.loppaAi`. The hosted edition has no such thing,
 * so a pane says "Not in this edition" there and no model code is ever asked for. Like
 * `model-bridge.ts`, this reads a property and imports no API client: what a pane sends goes to this
 * computer's shell through the bridge and nowhere else (`bundle-split.test.ts`, CAVEATS #43).
 */
export function aiBridge(): AiBridge | null {
  return typeof window !== 'undefined' && window.loppaAi ? window.loppaAi : null;
}
