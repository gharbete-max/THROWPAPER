import { useEffect, useRef, useState } from 'react';

/**
 * Motion, and the one rule that governs all of it.
 *
 * `prefers-reduced-motion` is not a preference in the way a colour scheme is. For somebody with a
 * vestibular disorder, a page that zooms, pans and slides things in as they scroll can cause real
 * nausea — and this product's whole surface is forms filled in by members of the public who never
 * chose to be here. So every animation in the app asks first, and the answer is respected by
 * removing the movement rather than by shortening it.
 *
 * Checked in JavaScript as well as in CSS because some of these are whole components — an intro
 * that plays once is not something a media query can decline; it has to not mount.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matches());

  useEffect(() => {
    // Some people turn it on *because* something on the page bothered them, so this listens
    // rather than reading once at mount.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function matches(): boolean {
  // `matchMedia` is missing in a test environment and in some embedded webviews. Assume *reduced*
  // when it cannot be asked: the failure mode of too little motion is a page that works.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveals an element the first time it comes into view.
 *
 * Returns a ref to attach and whether it has been seen. Once true it stays true — an element that
 * fades out again on scroll-up is a distraction rather than an effect, and it makes text
 * disappear from under somebody who is reading it.
 *
 * Falls back to "already revealed" wherever it cannot observe: reduced motion, no
 * `IntersectionObserver`. Content is never hidden behind an effect that might not run.
 */
export function useReveal<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  revealed: boolean;
} {
  const reduced = useReducedMotion();
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setRevealed(true);
      return;
    }
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== 'function') {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setRevealed(true);
          // One-way: stop watching the moment it has been seen.
          observer.disconnect();
        }
      },
      // A little before the edge, so a card is already in place by the time it is read.
      { rootMargin: '0px 0px -40px 0px', threshold: 0.01 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);

  return { ref, revealed };
}

/** Where the intro's "seen it" flag lives. Per browser, not per session — once is enough. */
export const INTRO_SEEN_KEY = 'tp.intro.seen';

/**
 * Whether the intro should play.
 *
 * Never on a repeat visit, never under reduced motion, and never when storage refuses — a private
 * window would otherwise replay it on every single load, which is the exact opposite of charming.
 */
export function shouldPlayIntro(reduced: boolean): boolean {
  if (reduced) return false;
  try {
    return window.localStorage.getItem(INTRO_SEEN_KEY) === null;
  } catch {
    return false;
  }
}

export function rememberIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // Storage refused. The intro simply will not play again this way either.
  }
}
