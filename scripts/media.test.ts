import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA as REGISTRY } from '../apps/forms/src/lib/media.js';

/**
 * The photographs in the app (`docs/brand/MEDIA.md`): every committed file is recorded there with
 * the hash of the bytes in the repository, stays inside the size budget, and has alt text in all
 * twelve catalogues. A photograph nobody can account for does not ship, and neither does an
 * original: the folder holds the graded WebP files and nothing else.
 */
const ROOT = join(import.meta.dirname, '..');
const MEDIA = join(ROOT, 'apps', 'forms', 'public', 'media');
const MESSAGES = join(ROOT, 'apps', 'forms', 'src', 'lib', 'messages');
const doc = readFileSync(join(ROOT, 'docs', 'brand', 'MEDIA.md'), 'utf8');
const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const files = readdirSync(MEDIA).filter((name) => !name.startsWith('.'));
const KB = 1024;

const ALT_KEYS = [
  'scan',
  'send',
  'sign',
  'forms',
  'fortune',
  'desk',
  'keep',
  'foil',
  'streaks',
  'blur',
  'summary',
];
const SHIPPED = [
  'ai-streaks',
  'forms-hand',
  'gallery-foil',
  'keep-plane',
  'models-blur',
  'scan-crane',
  'send-fortune',
  'send-waves',
  'sign-crane',
  'sign-desk',
  'summary-dark',
  'summary-light',
].map((name) => `${name}.webp`);

/** Width and height of a lossy WebP (VP8, the only kind `scripts/media-process.py` writes). */
function webpSize(bytes: Buffer) {
  expect(bytes.toString('ascii', 8, 15)).toBe('WEBPVP8');
  return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
}

describe('media', () => {
  it('has the photographs, and nothing else in the folder', () => {
    expect([...files].sort()).toEqual(SHIPPED);
  });

  it.each(files)('%s is recorded with its hash, source and licence', (name) => {
    const bytes = readFileSync(join(MEDIA, name));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const section = doc.split('### ').find((part) => part.startsWith(`\`${name}\``)) ?? '';
    expect(section, `${name} is not in docs/brand/MEDIA.md`).not.toBe('');
    expect(section).toContain(hash);
    expect(section).toMatch(/\*\*Source:\*\* <https:\/\/unsplash\.com\/photos\/[\w-]{11}>/);
    expect(section).toMatch(/\*\*Licence:\*\* Unsplash License /);
    expect(section).toMatch(/\*\*Photographer:\*\* \S/);
    expect(section).toMatch(/\*\*Retrieved:\*\* 2026-10-20/);
    expect(section).toMatch(/\*\*Original dimensions:\*\* \d+ x \d+ px/);
    // The size recorded is the size the file has, so the <img> attributes cannot drift from it.
    const [, width, height] = /cropped to (\d+) x (\d+)/.exec(section) ?? [];
    expect(webpSize(bytes)).toEqual({ width: Number(width), height: Number(height) });
    const key = /media\.alt\.(\w+)/.exec(section)?.[1] ?? '';
    expect(ALT_KEYS, `${name}: unknown alt key`).toContain(key);
  });

  it('the registry names real files at their real size, and an alt key for each', () => {
    expect(Object.keys(REGISTRY).sort()).toEqual([...ALT_KEYS].sort());
    for (const entry of Object.values(REGISTRY)) {
      for (const file of [entry.file, 'dark' in entry ? entry.dark : entry.file]) {
        const { width, height } = webpSize(readFileSync(join(MEDIA, `${file}.webp`)));
        expect({ width, height }).toEqual({ width: entry.width, height: entry.height });
      }
    }
  });

  it('stays inside the budget: 120 KB each, 1.2 MB in all', () => {
    const sizes = files.map((name) => readFileSync(join(MEDIA, name)).length);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(120 * KB);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1200 * KB);
  });

  it('is in the third-party notices', () => {
    expect(notices).toContain('apps/forms/public/media/');
    expect(notices).toContain('Unsplash License');
  });

  it('has alt text in all twelve catalogues', () => {
    const catalogues = readdirSync(MESSAGES).filter((name) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(name));
    expect(catalogues).toHaveLength(12);
    for (const name of catalogues) {
      const text = readFileSync(join(MESSAGES, name), 'utf8');
      for (const key of ALT_KEYS) {
        expect(text, `${name} lacks media.alt.${key}`).toContain(`'media.alt.${key}'`);
      }
    }
  });
});
