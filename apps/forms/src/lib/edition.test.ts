import { describe, expect, it } from 'vitest';
import { opensOnlyHere } from './edition.js';

describe('a link that opens only on this computer', () => {
  it('is one on the desktop that points at loopback, relative ones included', () => {
    const base = 'http://127.0.0.1:47017';
    expect(opensOnlyHere('/f/varmotet', 'desktop', base)).toBe(true);
    expect(opensOnlyHere('http://127.0.0.1:47018/s/abc', 'desktop', base)).toBe(true);
    expect(opensOnlyHere('http://localhost:5173/f/x', 'desktop', base)).toBe(true);
  });

  it('is not one when the desktop links somewhere online', () => {
    expect(opensOnlyHere('https://sign.example.com/s/abc', 'desktop')).toBe(false);
    expect(opensOnlyHere('http://127.0.0.1.example.com/s', 'desktop')).toBe(false);
  });

  it('is never said off the desktop, or before the server has answered', () => {
    expect(opensOnlyHere('/f/x', 'server', 'http://localhost:5173')).toBe(false);
    expect(opensOnlyHere('/f/x', null, 'http://127.0.0.1:47017')).toBe(false);
  });
});
