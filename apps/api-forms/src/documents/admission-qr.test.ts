import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { ADMISSION_QR, QR_DARK } from './admission.js';

/**
 * The one thing on the admission card that has to work for a machine.
 *
 * Everything else on that page is read by a person who can squint, turn it over, or ask. The QR is
 * scanned once, at a door, by somebody with a queue behind them, and if it fails there is no
 * fallback but typing the reference by hand.
 *
 * It was generated with `margin: 0` — no quiet zone at all. The specification asks for four clear
 * modules on every side and decoders use them to find where the symbol ends; without them the code
 * ran straight into a parchment card whose colour was not even the same as the light modules. It
 * scanned in testing, because a phone held still under an office light will read almost anything.
 */
describe('the admission QR', () => {
  it('keeps the four-module quiet zone the specification asks for', () => {
    expect(ADMISSION_QR.margin).toBeGreaterThanOrEqual(4);
  });

  it('corrects enough to survive a fold', () => {
    // `M` (~15%) is the right default for a screen. This card is printed and put in a pocket.
    expect(['Q', 'H']).toContain(ADMISSION_QR.errorCorrectionLevel);
  });

  /**
   * Measured on the produced symbol rather than trusted from the options.
   *
   * The options are what we asked for; this is what the library drew. A version bump that changed
   * how `margin` is interpreted would leave the constant right and the card wrong.
   */
  it('actually draws the quiet zone into the symbol', async () => {
    const svg = await QRCode.toString('reference.signature', {
      ...ADMISSION_QR,
      color: { dark: QR_DARK, light: '#faf7f0' },
    });

    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(viewBox, 'the SVG should carry a module-unit viewBox').not.toBeNull();

    const size = Number(viewBox![1]);
    // The smallest QR is 21 modules; with 4 either side the drawing is at least 29 across.
    expect(size).toBeGreaterThanOrEqual(29);

    /**
     * The corner has to be blank. Every QR has a finder pattern at three corners, inset by exactly
     * the quiet zone — so if the very first module is dark, the margin was dropped.
     */
    const withoutZone = await QRCode.toString('reference.signature', {
      ...ADMISSION_QR,
      margin: 0,
      color: { dark: QR_DARK, light: '#faf7f0' },
    });
    const bare = /viewBox="0 0 (\d+) (\d+)"/.exec(withoutZone);
    expect(size - Number(bare![1]), 'four modules on each side is eight in total').toBe(8);
  });

  it('draws the dark modules in black rather than the brand ink', () => {
    // Deliberate, and the one place in this product a colour is not a token: it is the contrast a
    // camera needs. A customer whose brand ink is a mid grey must still get a code that scans.
    expect(QR_DARK).toBe('#000000');
  });
});
