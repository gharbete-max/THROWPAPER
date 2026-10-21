/**
 * Text over a photograph, held to a number (`docs/brand/MEDIA.md`).
 *
 * Nothing is written over a photograph in the app today. The day something is — a caption, a label
 * chip — it is drawn one of two ways, and `media-contrast.test.ts` checks both against the worst
 * pixel of every shipped picture, in both themes, with the same maths as the rest of this package:
 *
 * - **a scrim**: black, rising to {@link IMAGE_SCRIM.alpha} by {@link IMAGE_SCRIM.fullFrom} of the
 *   picture's height and staying there to the bottom, with {@link IMAGE_TEXT} text in the part
 *   below it;
 * - **a chip**: the theme's background at {@link IMAGE_CHIP_ALPHA}, with the theme's text on it,
 *   anywhere on the picture.
 *
 * A scrim is shadow, not brand: black in both themes, never a mix with the palette.
 */
export const IMAGE_SCRIM = { colour: '#000000', alpha: 0.6, fullFrom: 2 / 3 } as const;

/** Text on a scrim. */
export const IMAGE_TEXT = '#ffffff';

export const IMAGE_CHIP_ALPHA = 0.88;

/** The dark theme dims every photograph by this much (`.banner`, `.empty__media` in the stylesheet). */
export const IMAGE_DIM = 0.82;
