/**
 * The photographs in the app (`docs/brand/MEDIA.md`): one place for which file serves which role,
 * and its size, so every `<img>` carries `width`/`height` and the box is reserved before it loads.
 * The alt text of `x` is the catalogue key `media.alt.x`. Never used in the room.
 */
export const MEDIA = {
  scan: { file: 'scan-crane', width: 1120, height: 400 },
  send: { file: 'send-waves', width: 1120, height: 400 },
  sign: { file: 'sign-crane', width: 1120, height: 400 },
  forms: { file: 'forms-hand', width: 1120, height: 400 },
  fortune: { file: 'send-fortune', width: 1600, height: 600 },
  desk: { file: 'sign-desk', width: 1600, height: 600 },
  keep: { file: 'keep-plane', width: 1600, height: 600 },
  foil: { file: 'gallery-foil', width: 1600, height: 600 },
  streaks: { file: 'ai-streaks', width: 1600, height: 600 },
  blur: { file: 'models-blur', width: 1600, height: 240 },
  /** The one with a second file for the dark theme. */
  summary: { file: 'summary-light', dark: 'summary-dark', width: 1600, height: 600 },
} as const;

export type MediaName = keyof typeof MEDIA;
