import { useEffect, useState } from 'react';
import { client } from './api.js';

/**
 * Whether this app is served by the desktop edition, asked of the server once per page load.
 *
 * The same bundle runs on a server and inside the desktop app, and only the server knows which it
 * is (`/health`, like the demo banner in `demo.tsx`). The desktop is offline first: its mail waits
 * in **To send** for the person to send it themselves, its links point at this computer and open
 * nowhere else, and there is nobody else to invite.
 *
 * `null` until the answer arrives, and after a failure: a screen shows nothing edition-specific
 * rather than guessing.
 */
export type Edition = 'desktop' | 'server';

/** Where signers' links point: this computer (the desktop's own Sign), somewhere online, or no Sign. */
export type SigningLinks = 'this-computer' | 'online' | 'off';

interface Facts {
  edition: Edition;
  signing: SigningLinks;
}

let asked: Promise<Facts | null> | null = null;

function askOnce(): Promise<Facts | null> {
  asked ??= client.health().then(
    (health) => ({ edition: health.edition ?? 'server', signing: health.signing ?? 'off' }),
    () => {
      // Ask again next time rather than remembering a failure for the life of the page.
      asked = null;
      return null;
    },
  );
  return asked;
}

function useFacts(): Facts | null {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    let cancelled = false;
    void askOnce().then((answer) => {
      if (!cancelled) setFacts(answer);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return facts;
}

export function useEdition(): Edition | null {
  return useFacts()?.edition ?? null;
}

/**
 * Whether signers' links can reach anybody else. On the desktop with its own Sign they cannot:
 * an invitation or a reminder by email would carry a link that opens only here.
 */
export function useSignersLinksAreLocal(): boolean {
  const facts = useFacts();
  return facts?.edition === 'desktop' && facts.signing === 'this-computer';
}

/**
 * Whether a link opens only on this computer: on the desktop, and pointing at a loopback address.
 * Only the desktop says so — a developer's `localhost` is not what the note is for — and only for
 * links that really are local, so a desktop connected to an online Sign says nothing of its links.
 */
export function opensOnlyHere(
  url: string,
  edition: Edition | null,
  base: string = globalThis.location?.origin ?? 'http://invalid',
): boolean {
  if (edition !== 'desktop') return false;
  try {
    const host = new URL(url, base).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

/** Raised when To send changes, so the count beside it follows without a navigation. */
export const OUTGOING_CHANGED = 'tp:outgoing-changed';
