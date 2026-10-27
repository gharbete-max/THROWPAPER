import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';

/** Where the tour's "seen it" flag lives. Per browser, like the intro's. */
export const TOUR_KEY = 'tp.tour.seen';
const TOUR_EVENT = 'tp:tour';
/** Set by `startTour` so a tour asked for from another screen starts when home mounts. */
let requested = false;

/** Plays the tour again (More → Show me around). Works whether or not home is mounted yet. */
export function startTour(): void {
  requested = true;
  window.dispatchEvent(new Event(TOUR_EVENT));
}

/** The steps, in order: each points at the element marked `data-tour="<target>"`. */
const STEPS = ['forms', 'scan', 'sign', 'send', 'more'] as const;

function seen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_KEY) !== null;
  } catch {
    // Storage refused: a private window would replay it every load, so it does not play.
    return true;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(TOUR_KEY, '1');
  } catch {
    // It simply plays again next time.
  }
}

const find = (target: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find(
    (el) => el.getBoundingClientRect().width > 0,
  );

/**
 * The first-run tour (`docs/plan/EASY.md`, E2): five speech bubbles on home, one at a time, each
 * pointing at the real thing. Not modal — nothing is dimmed or locked, the page under it still
 * works. Next, Skip and Escape all end it for good; a step whose target is not on screen (the rail
 * on a phone) is passed over. Starts once the start-up intro has gone.
 */
export function Coach() {
  const t = useT();
  const [step, setStep] = useState<number | null>(null);
  const [spot, setSpot] = useState<{ top: number; left: number; side: 'below' | 'right' } | null>(
    null,
  );
  const bubble = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  const begin = useCallback(() => {
    requested = false;
    setStep(0);
  }, []);

  useEffect(() => {
    window.addEventListener(TOUR_EVENT, begin);
    // The intro plays over a first arrival; the tour waits for it.
    const timer = setInterval(() => {
      if (document.querySelector('.intro__stage')) return;
      clearInterval(timer);
      begin();
    }, 300);
    if (!requested && seen()) clearInterval(timer);
    return () => {
      clearInterval(timer);
      window.removeEventListener(TOUR_EVENT, begin);
    };
  }, [begin]);

  const target = step === null ? undefined : find(STEPS[step]!);
  const end = useCallback(() => {
    remember();
    setStep(null);
  }, []);
  const go = useCallback(
    (from: number) => {
      let n = from;
      while (n < STEPS.length && !find(STEPS[n]!)) n += 1;
      if (n >= STEPS.length) end();
      else setStep(n);
    },
    [end],
  );

  // A step whose target is not there is passed over.
  useEffect(() => {
    if (step !== null && !target) go(step + 1);
  }, [step, target, go]);

  useLayoutEffect(() => {
    if (!target) return setSpot(null);
    const place = () => {
      const r = target.getBoundingClientRect();
      const wide = window.innerWidth > 760 && STEPS[step!] === 'more';
      const width = bubble.current?.offsetWidth ?? 280;
      const left = wide
        ? r.right + 14
        : Math.min(Math.max(r.left, 8), window.innerWidth - width - 8);
      const height = bubble.current?.offsetHeight ?? 140;
      const top = wide
        ? r.top
        : r.bottom + 14 + height > window.innerHeight
          ? Math.max(8, r.top - height - 14)
          : r.bottom + 14;
      setSpot({ top, left, side: wide ? 'right' : 'below' });
    };
    place();
    target.classList.add('coach-on');
    window.addEventListener('resize', place);
    return () => {
      target.classList.remove('coach-on');
      window.removeEventListener('resize', place);
    };
  }, [target, step]);

  useEffect(() => {
    if (step === null || !spot) return;
    next.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, end, spot]);

  if (step === null || !target) return null;
  const last = step === STEPS.length - 1;
  return (
    <div
      ref={bubble}
      className={`coach coach--${spot?.side ?? 'below'}`}
      role="dialog"
      aria-label={t('tour.label')}
      style={{
        top: spot?.top ?? 0,
        left: spot?.left ?? 0,
        visibility: spot ? 'visible' : 'hidden',
      }}
    >
      <p className="coach__text" aria-live="polite">
        {t(`tour.${STEPS[step]!}`)}
      </p>
      <div className="coach__row">
        <button type="button" className="button button--quiet small" onClick={end}>
          {t('tour.skip')}
        </button>
        <span className="coach__count small">
          {step + 1} / {STEPS.length}
        </span>
        <button
          ref={next}
          type="button"
          className="button small"
          onClick={() => (last ? end() : go(step + 1))}
        >
          {last ? t('tour.done') : t('tour.next')}
        </button>
      </div>
    </div>
  );
}
