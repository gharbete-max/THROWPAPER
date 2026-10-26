import type { AddonsBridge } from '@tp/shared/ai';

declare global {
  interface Window {
    /** The desktop shell's add-ons and updates. Absent in a browser and on a server. */
    loppaAddons?: AddonsBridge;
  }
}

/**
 * The shell's add-ons bridge, or null where this edition has none (ADR 0026, amended). Like
 * `ai-bridge.ts` it reads a property and imports no API client: what the page asks for goes to the
 * desktop shell on this computer, which alone talks to the network, and only after a confirmation.
 */
export function addonsBridge(): AddonsBridge | null {
  return typeof window !== 'undefined' && window.loppaAddons ? window.loppaAddons : null;
}
