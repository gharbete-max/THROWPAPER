import { describe, expect, it } from 'vitest';
import { sortedSuppressions, validAddress } from './suppressions.js';

const entry = (email: string) => ({ email, reason: 'manual' as const, createdAt: '2026-01-01' });

describe('the do-not-email list', () => {
  it('sorts by address with the language’s collation: å after z in Swedish, not in German', () => {
    const items = [entry('åsa@x.se'), entry('zeke@x.se'), entry('anna@x.se')];
    expect(sortedSuppressions(items, 'sv-SE').map((e) => e.email)).toEqual([
      'anna@x.se',
      'zeke@x.se',
      'åsa@x.se',
    ]);
    expect(sortedSuppressions(items, 'de-DE').map((e) => e.email)).toEqual([
      'anna@x.se',
      'åsa@x.se',
      'zeke@x.se',
    ]);
  });

  it('leaves the list it was given alone', () => {
    const items = [entry('b@x.se'), entry('a@x.se')];
    sortedSuppressions(items, 'en-GB');
    expect(items[0]!.email).toBe('b@x.se');
  });

  it('accepts an address, trimmed, and refuses what is not one', () => {
    expect(validAddress('  a@example.com ')).toBe('a@example.com');
    expect(validAddress('not an address')).toBeNull();
    expect(validAddress('')).toBeNull();
  });
});
