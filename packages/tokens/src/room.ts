/**
 * The room's colours: the one screen where Loppa is not paper on a light page (ADR 0022).
 *
 * You arrive in an empty dark grey room where three cootie catchers float, each over a colour of
 * its own. The owner named those colours as Loppa's, "exaggerated" so they stand out against the
 * grey, so they are the brand's foil faces pushed stronger:
 *
 * | Name       | Brand's own | Here      | On the grey |
 * | ---------- | ----------- | --------- | ----------- |
 * | `gold`     | `#cea85c`   | `#ebbd4e` | 8.02:1      |
 * | `platinum` | `#c6cad1`   | `#d3dae6` | 10.05:1     |
 * | `bronze`   | `#8f6b3a`   | `#bc7f3a` | 4.19:1      |
 *
 * Bronze as shipped reads at 2.95:1 on a dark grey, under the 3:1 a shape needs, so it is lifted.
 * Gold and platinum are close in lightness, so they part by warmth: gold warmer, platinum cooler.
 *
 * These are fixed, like the easings. They are not brand-kit colours, a customer's kit does not
 * change them, they never mean a status, and nothing outside the room uses them. `room.test.ts`
 * holds every number above.
 */
export const ROOM = {
  /** The room. A cool dark grey from platinum's family, not the derived dark's near-black. */
  grey: '#2a2b30',
  /** The room's raised parts: its bar and the labels on an opened catcher. */
  shade: '#1f2024',
  /** Words. Platinum's pale tier, as on the light page's cards. */
  ink: '#e9ebee',
  /** Secondary words, such as "Not built yet". */
  quiet: '#a3a8b0',
  gold: '#ebbd4e',
  platinum: '#d3dae6',
  bronze: '#bc7f3a',
} as const;

/** The three colours that sit beneath a catcher. Which catcher wears which is the app's. */
export const ROOM_HUES = ['gold', 'platinum', 'bronze'] as const;
export type RoomHue = (typeof ROOM_HUES)[number];

/** The room's colours as CSS custom properties, `--tp-room-<name>`, set on the room alone. */
export function roomCssVariables(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ROOM).map(([name, value]) => [`--tp-room-${name}`, value]),
  );
}
