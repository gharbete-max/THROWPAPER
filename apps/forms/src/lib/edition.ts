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

let asked: Promise<Edition | null> | null = null;

function askOnce(): Promise<Edition | null> {
  asked ??= client.health().then(
    (health) => health.edition ?? 'server',
    () => {
      // Ask again next time rather than remembering a failure for the life of the page.
      asked = null;
      return null;
    },
  );
  return asked;
}

export function useEdition(): Edition | null {
  const [edition, setEdition] = useState<Edition | null>(null);
  useEffect(() => {
    let cancelled = false;
    void askOnce().then((answer) => {
      if (!cancelled) setEdition(answer);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return edition;
}

/** A link on the desktop points at this computer's loopback address: it opens nowhere else. */
export function isLocalOnly(edition: Edition | null): boolean {
  return edition === 'desktop';
}
