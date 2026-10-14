import { describe, expect, it } from 'vitest';
import { ATTACHMENT_WARN_BYTES, canShrink, formatMegabytes, isHeavy } from './attachment-size.js';
import { SEND_LIMITS } from '@tp/shared/api';

describe('attachment size', () => {
  it('warns above 10 MB and not at it, and below the hard limit', () => {
    expect(ATTACHMENT_WARN_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENT_WARN_BYTES).toBeLessThan(SEND_LIMITS.attachmentBytes);
    expect(isHeavy(ATTACHMENT_WARN_BYTES)).toBe(false);
    expect(isHeavy(ATTACHMENT_WARN_BYTES + 1)).toBe(true);
    expect(isHeavy(0)).toBe(false);
  });

  it('writes sizes in megabytes, at least 0.1', () => {
    expect(formatMegabytes(0)).toBe('0.1 MB');
    expect(formatMegabytes(1536 * 1024)).toBe('1.5 MB');
    expect(formatMegabytes(12 * 1024 * 1024)).toBe('12.0 MB');
  });

  it('offers to shrink a PDF only', () => {
    expect(canShrink({ name: 'Avtal.PDF' })).toBe(true);
    expect(canShrink({ name: 'scan', type: 'application/pdf' })).toBe(true);
    expect(canShrink({ name: 'brev.docx' })).toBe(false);
  });
});
