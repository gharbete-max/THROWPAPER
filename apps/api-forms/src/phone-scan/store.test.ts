import { describe, expect, it } from 'vitest';
import { createPhoneScanStore } from './store.js';

describe('phone scans held in memory', () => {
  it('refuses a page once everybody together holds the limit, and makes room as scans close', () => {
    const store = createPhoneScanStore(Date.now, 1000);
    const a = store.open({ organisationId: 'o', userId: 'a' });
    const b = store.open({ organisationId: 'o', userId: 'b' });
    const page = (bytes: number) => ({
      contentType: 'image/jpeg' as const,
      bytes: new Uint8Array(bytes),
    });

    expect(store.add(a.session, page(600))).toBe(true);
    expect(store.add(b.session, page(300))).toBe(true);
    // Another person's session, but the same memory.
    expect(store.add(b.session, page(200))).toBe(false);

    store.close(a.session.id);
    expect(store.add(b.session, page(200))).toBe(true);
  });
});
