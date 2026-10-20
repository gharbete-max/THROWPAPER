import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The photographs in the app (`docs/brand/MEDIA.md`): every committed file is recorded there with
 * the hash of the bytes in the repository, stays inside the size budget, and has alt text in all
 * twelve catalogues. A photograph nobody can account for does not ship.
 */
const ROOT = join(import.meta.dirname, '..');
const MEDIA = join(ROOT, 'apps', 'forms', 'public', 'media');
const MESSAGES = join(ROOT, 'apps', 'forms', 'src', 'lib', 'messages');
const doc = readFileSync(join(ROOT, 'docs', 'brand', 'MEDIA.md'), 'utf8');
const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const files = readdirSync(MEDIA).filter((name) => !name.startsWith('.'));
const KB = 1024;

describe('media', () => {
  it('has the photographs', () => {
    expect(files.sort()).toEqual([
      'forms-typewriter.webp',
      'scan-pages.webp',
      'send-plane.webp',
      'sign-pen.webp',
    ]);
  });

  it.each(files)('%s is recorded with its hash, source and licence', (name) => {
    const hash = createHash('sha256')
      .update(readFileSync(join(MEDIA, name)))
      .digest('hex');
    const section = doc.split('### ').find((part) => part.startsWith(`\`${name}\``)) ?? '';
    expect(section, `${name} is not in docs/brand/MEDIA.md`).not.toBe('');
    expect(section).toContain(hash);
    expect(section).toMatch(/\*\*Source:\*\* <https:\/\/commons\.wikimedia\.org\//);
    expect(section).toMatch(/\*\*Licence:\*\* CC0 /);
    expect(section).toMatch(/\*\*Original dimensions:\*\* \d+ x \d+ px/);
  });

  it('stays inside the budget: 120 KB each, 600 KB in all', () => {
    const sizes = files.map((name) => readFileSync(join(MEDIA, name)).length);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(120 * KB);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600 * KB);
  });

  it('is in the third-party notices', () => {
    expect(notices).toContain('apps/forms/public/media/');
    expect(notices).toContain('CC0');
  });

  it('has alt text in all twelve catalogues', () => {
    const catalogues = readdirSync(MESSAGES).filter((name) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(name));
    expect(catalogues).toHaveLength(12);
    for (const name of catalogues) {
      const text = readFileSync(join(MESSAGES, name), 'utf8');
      for (const key of ['scan', 'send', 'sign', 'forms']) {
        expect(text, `${name} lacks media.alt.${key}`).toContain(`'media.alt.${key}'`);
      }
    }
  });
});
