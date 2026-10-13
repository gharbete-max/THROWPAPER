import type { ModelBridge } from '@tp/shared/summary';

declare global {
  interface Window {
    /** The desktop shell's bridge to the summary model. Absent in a browser and on a server. */
    loppaModel?: ModelBridge;
  }
}

/**
 * The summary model's bridge, or null where this edition has none (ADR 0023).
 *
 * Only the desktop app's preload defines `window.loppaModel`. The hosted edition has no such
 * thing, so the centre says "Not in this edition" there and no model code is ever asked for. This
 * file reads a property and imports no API client: a reading's text goes to this computer's shell
 * through the bridge and nowhere else (`bundle-split.test.ts`, CAVEATS #43).
 */
export function modelBridge(): ModelBridge | null {
  return typeof window !== 'undefined' && window.loppaModel ? window.loppaModel : null;
}
