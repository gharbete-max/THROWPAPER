import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brand } from '@tp/shared';
import { defaultTokens } from '@tp/tokens';

/**
 * The corner under white-label, where the failures are all quiet ones.
 *
 * Every case here is a state a customer can reach from the settings screen in two clicks, and none
 * of them throws — they render *something*, and the something is either their brand or ours. Ours
 * appearing on their page is the failure the whole feature exists to prevent, and it does not look
 * like a bug to anybody testing it, because the person testing it works here.
 */
const SOURCE = readFileSync(new URL('./Logo.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const kit = (over: Record<string, unknown>) => brand.BrandKit.parse({ ...defaultTokens, ...over });

describe('the client lockup', () => {
  it('defaults to off, with no name of its own', () => {
    const shipped = brand.BrandKit.parse(defaultTokens);
    expect(shipped.clientMode).toBe(false);
    expect(shipped.wordmark).toBeNull();
  });

  /**
   * Turning it off must not mean deleting what was uploaded.
   *
   * This is why the mode is a flag rather than "has a logo". Somebody uploads, previews, and
   * decides later; inferring the mode from the file makes the off switch destructive and makes
   * "let me see it without" a thing you cannot do.
   */
  it('keeps the assets when the mode is switched off', () => {
    const configured = kit({
      clientMode: false,
      wordmark: 'Acme',
      logoLight: `/public/assets/${'a'.repeat(64)}.png`,
    });
    expect(configured.logoLight).not.toBeNull();
    expect(configured.wordmark).toBe('Acme');
  });

  /** A name long enough to push the navigation off a phone is not a name. */
  it('caps the wordmark rather than letting it push the bar apart', () => {
    expect(brand.BrandKit.safeParse({ ...defaultTokens, wordmark: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(brand.BrandKit.safeParse({ ...defaultTokens, wordmark: 'x'.repeat(60) }).success).toBe(
      true,
    );
  });

  /** Whitespace is not a wordmark, and an empty one must fall back rather than render a gap. */
  it('refuses a blank wordmark instead of storing an invisible one', () => {
    expect(brand.BrandKit.safeParse({ ...defaultTokens, wordmark: '   ' }).success).toBe(false);
  });

  /**
   * The logo is still an asset path, so client mode did not open a hole.
   *
   * `AssetPath` is what stops a customer pointing every page at a third-party host — which leaks
   * each visitor's IP there and hands whoever runs it control of what the corner shows. A
   * white-label field asking for "your logo" is exactly where somebody would expect to paste a URL.
   */
  it('still refuses an arbitrary URL for the logo', () => {
    for (const value of [
      'https://cdn.example.com/logo.png',
      '/public/assets/../../etc/passwd',
      'javascript:alert(1)',
      `/public/assets/${'a'.repeat(64)}.svg`,
    ]) {
      expect(
        brand.BrandKit.safeParse({ ...defaultTokens, logoLight: value }).success,
        `${value} was accepted`,
      ).toBe(false);
    }
  });

  /**
   * Our mark must not render on a white-labelled page, even while a logo is missing.
   *
   * The tempting shape is `clientLogo ? <img/> : <Logo/>`, which is correct for every case except
   * the one that matters: client mode on with a broken or absent file falls through to *our* mark
   * on *their* page. The name alone is the right fallback there.
   */
  it('never falls back to our mark when client mode is on', () => {
    expect(SOURCE).toContain('!tokens.clientMode && <Logo />');
  });

  /** A failed image swaps to the name rather than leaving a broken-image icon in the bar. */
  it('handles a logo that 404s', () => {
    expect(SOURCE).toContain('onError');
    expect(SOURCE).toContain('logoFailed');
  });
});

describe('what the lockup does to a customer’s asset', () => {
  /**
   * Nothing but sizing.
   *
   * A border invents a boundary their designer did not draw, a radius crops their corners, and a
   * filter is recolouring under another name. The brand handoff says never to do any of it to a
   * client's logo, and a stylesheet is where it would happen by accident — a generic `img` rule
   * with a radius on it would reach this without anybody deciding to.
   */
  it('adds no container, no crop and no recolouring', () => {
    const rule = /\.lockup__logo\s*\{([^}]*)\}/.exec(CSS)?.[1];
    expect(rule, 'the lockup logo has no rule of its own').toBeDefined();
    expect(rule).not.toMatch(/border|background|border-radius|box-shadow|filter|backdrop/);
    // `contain` rather than `cover`: whatever aspect ratio they uploaded is what renders.
    expect(rule).toContain('object-fit: contain');
  });

  /** Height is ours because the bar has one; width follows so nothing is squashed. */
  it('lets the width follow the height', () => {
    const rule = /\.lockup__logo\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/inline-size:\s*auto/);
    expect(rule).toMatch(/block-size:/);
  });
});
