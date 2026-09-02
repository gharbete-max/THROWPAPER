import { useEffect, useState } from 'react';
import { rememberIntroSeen, shouldPlayIntro, useReducedMotion } from '../lib/motion.js';
import { useT } from '../lib/i18n.js';

/**
 * The one-second intro: a figure winds up and throws a paper plane, and the camera follows it.
 *
 * ## The rules it plays by
 *
 * **Once.** Remembered in `localStorage`, so a second visit goes straight to the product. An
 * animation you cannot get past is charming exactly once and irritating every time after.
 *
 * **Never under reduced motion.** It zooms and pans, which is the specific combination that makes
 * people with vestibular disorders ill. It does not mount at all — a media query cannot decline a
 * component.
 *
 * **Never blocking.** The app is mounted and interactive underneath the whole time; this is an
 * overlay that fades. Anything typed or clicked during it lands. Escape, a click, or any key
 * dismisses it immediately, and it removes itself when it finishes.
 *
 * ## Why SVG and CSS rather than a video
 *
 * A video is a network request, a decoder, a format matrix and a file nobody can restyle. This is
 * a few paths that take their colour from the Brand Kit like everything else, weighs nothing, and
 * is legible at any size.
 */
const DURATION_MS = 1000;
/** Long enough for the fade-out to finish before the node goes. */
const FADE_MS = 260;

export function Intro() {
  const t = useT();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<'idle' | 'playing' | 'leaving' | 'gone'>('idle');

  useEffect(() => {
    // Decided in an effect rather than at render, because it reads storage and the media query.
    setPhase(shouldPlayIntro(reduced) ? 'playing' : 'gone');
  }, [reduced]);

  useEffect(() => {
    if (phase !== 'playing') return;
    rememberIntroSeen();

    const finish = setTimeout(() => setPhase('leaving'), DURATION_MS);
    const dismiss = () => setPhase('leaving');

    // Any input at all cuts it short. Nobody should have to wait out a decoration.
    window.addEventListener('keydown', dismiss);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      clearTimeout(finish);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'idle' || phase === 'gone') return null;

  return (
    <div
      className={phase === 'leaving' ? 'intro intro--leaving' : 'intro'}
      /**
       * Hidden from the accessibility tree entirely. It carries no information — the product is
       * already behind it — and announcing a decoration is worse than silence.
       */
      aria-hidden="true"
    >
      <div className="intro__stage">
        <svg className="intro__scene" viewBox="0 0 240 120" fill="none">
          {/* The thrower. Blocky, like the mark: a head, a body, and one arm that swings. */}
          <g className="intro__figure">
            {/**
             * The head sits high and the shoulder low, so the arm's arc clears it.
             *
             * The first attempt had them level: at the top of the wind-up the arm swung straight
             * through the head and simply disappeared, which is not something the code could have
             * told me — it took looking at a frame.
             */}
            <circle cx="40" cy="34" r="8" fill="currentColor" />
            <path d="M40 42 L40 82" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
            <path
              d="M40 82 L32 102 M40 82 L50 102"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              className="intro__arm"
              d="M40 50 L56 56"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
            />
          </g>

          {/**
           * The trail, revealed by a wipe that travels with the plane.
           *
           * A clip rectangle scaled from nothing rather than a dash animation: the dashes have to
           * stay put on the path while the *reveal* moves, and animating `stroke-dashoffset` would
           * slide the dashes along instead of uncovering them.
           */}
          <clipPath id="intro-trail-wipe">
            <rect className="intro__wipe" x="0" y="0" width="240" height="120" />
          </clipPath>
          <path
            className="intro__trail"
            clipPath="url(#intro-trail-wipe)"
            d="M60 62 C92 34 118 26 150 40 C186 56 208 54 236 46"
            stroke="var(--tp-colour-border)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="8 10"
          />

          {/**
           * The plane, thrown across the frame and turning as it goes.
           *
           * The same two-wing shape and the same two colours as the mark, at a twelfth the size,
           * so the thing being thrown and the thing in the top bar are recognisably one object.
           */}
          <g className="intro__paper">
            <path d="M14 -7 L-14 4 L-1.5 8.5 Z" fill="var(--tp-colour-primary)" />
            <path d="M14 -7 L-1.5 8.5 L2 19.5 Z" fill="var(--tp-colour-accent)" />
          </g>
        </svg>

        <p className="intro__word">{t('app.name')}</p>
      </div>
    </div>
  );
}
