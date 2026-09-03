import { useEffect, useState } from 'react';
import { rememberIntroSeen, shouldPlayIntro, useReducedMotion } from '../lib/motion.js';
import { useT } from '../lib/i18n.js';
import { FortuneTeller } from './FortuneTeller.js';

/**
 * The intro: a square of paper is worked like a fortune teller, then folds into the mark.
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
 * four paths that take their colour from the Brand Kit like everything else, weighs nothing, and
 * is legible at any size.
 *
 * The fold is `d` interpolation between poses that are all four triangles — see
 * `FortuneTeller.tsx`. Where a browser will not interpolate `d`, the paths keep the pose in their
 * markup and the intro is a still fortune teller for its second on screen, which is a decoration
 * that did not move rather than a broken one.
 */
/** The fold runs 2.8s; the overlay leaves a beat after the mark lands. */
const DURATION_MS = 3000;
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
        {/*
          The whole intro is now one object: a sheet of paper folded into the mark.

          It replaced a figure winding up and throwing a dart. That was two ideas — a person, and
          a plane — and the person was doing the work. This is the product's own mark being made,
          which is a shorter thing to say and needs no thrower, no trail and no camera move.

          It is the same component the loading indicator uses, in `fold` rather than `pinch`, so
          the shape somebody watches while waiting is the shape that becomes the logo.
        */}
        <FortuneTeller mode="fold" className="intro__ft" />

        <p className="intro__word">{t('app.name')}</p>
      </div>
    </div>
  );
}
