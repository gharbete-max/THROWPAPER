import { describe, expect, it } from 'vitest';
import { BOUNDARY_CONTRAST, TEXT_CONTRAST, contrastRatio, parseHex } from './contrast.js';
import { defaultTokens } from './index.js';
import { ROOM, ROOM_HUES, roomCssVariables } from './room.js';

/**
 * The room's colours, held to what the owner asked for (ADR 0022, `docs/plan/DOCUMENTS.md` §2).
 *
 * "Loppa's colours but maybe exaggerated to make sure it's a little bit contrast": so each colour
 * beneath a catcher is one of the brand's own, made stronger, and it has to stand out against the
 * dark grey. A palette change that quietly swaps one for a new hue, or lets bronze sink back under
 * 3:1, fails here rather than in a screenshot nobody measures.
 */
const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0;

/** Hue in degrees and saturation in per cent, HSL, for a `#rrggbb` value. */
function hueOf(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = parseHex(hex)!.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation: saturation * 100 };
}

/** The brand's own colour each stronger one is made from (`DESIGN.md`, the foil's faces). */
const BRAND = { gold: '#cea85c', platinum: '#c6cad1', bronze: '#8f6b3a' } as const;

describe('the room', () => {
  it('is dark grey, not the derived dark theme’s near-black', () => {
    expect(hueOf(ROOM.grey).saturation).toBeLessThan(12);
    expect(ratio(ROOM.grey, defaultTokens.colour.text)).toBeGreaterThan(1.3);
    expect(ratio(ROOM.ink, ROOM.grey)).toBeGreaterThan(10);
  });

  it('puts each catcher over a colour that stands out against the grey', () => {
    for (const hue of ROOM_HUES) {
      expect(ratio(ROOM[hue], ROOM.grey), `${hue} on the grey`).toBeGreaterThanOrEqual(
        BOUNDARY_CONTRAST,
      );
    }
  });

  it('makes each of them one of Loppa’s own colours, stronger', () => {
    for (const hue of ROOM_HUES) {
      const stronger = hueOf(ROOM[hue]);
      const brand = hueOf(BRAND[hue]);
      expect(Math.abs(stronger.hue - brand.hue), `${hue} keeps the brand's hue`).toBeLessThan(12);
      expect(stronger.saturation, `${hue} is more saturated`).toBeGreaterThan(brand.saturation);
      expect(
        ratio(ROOM[hue], ROOM.grey),
        `${hue} reads better than the brand's own`,
      ).toBeGreaterThan(ratio(BRAND[hue], ROOM.grey));
    }
  });

  it('measures what the plan measured for the brand’s own bronze', () => {
    // The reason bronze is lifted: as shipped it does not reach 3:1 on a dark grey.
    expect(ratio(BRAND.bronze, '#2a2a2e')).toBe(2.95);
  });

  it('keeps its words readable on the grey and on the shade', () => {
    for (const text of [ROOM.ink, ROOM.quiet]) {
      expect(ratio(text, ROOM.grey)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      expect(ratio(text, ROOM.shade)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
  });

  it('names every colour as a room variable', () => {
    const vars = roomCssVariables();
    expect(Object.keys(vars).sort()).toEqual(
      Object.keys(ROOM)
        .map((name) => `--tp-room-${name}`)
        .sort(),
    );
    expect(vars['--tp-room-gold']).toBe(ROOM.gold);
  });
});
