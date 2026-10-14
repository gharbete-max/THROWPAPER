import { describe, expect, it } from 'vitest';
import { filesForSize, KEEP_SIZES, SIZE_SETTINGS } from './keep-size.js';

describe('the size choices', () => {
  it('shrink from Small to Medium to Original', () => {
    const small = SIZE_SETTINGS.small!;
    const medium = SIZE_SETTINGS.medium!;
    expect(small.longSide).toBeLessThan(medium.longSide);
    expect(small.quality).toBeLessThan(medium.quality);
    expect(SIZE_SETTINGS.original).toBeNull();
    expect(KEEP_SIZES).toEqual(['small', 'medium', 'original']);
  });

  it('leaves a PDF alone and counts it in every size', async () => {
    const pdf = new File([new Uint8Array(1000)], 'a.pdf', { type: 'application/pdf' });
    for (const size of KEEP_SIZES) {
      const made = await filesForSize([pdf], () => false, size);
      expect(made.files[0]).toBe(pdf);
      expect(made.bytes).toBe(1000);
    }
  });

  it('keeps the photograph itself for Original', async () => {
    const photo = new File([new Uint8Array(5000)], 'p.jpg', { type: 'image/jpeg' });
    const made = await filesForSize([photo], () => true, 'original');
    expect(made.files[0]).toBe(photo);
  });
});
// Small < Medium < Original on a real photograph needs a canvas: `e2e/documents-flow.spec.ts`.
