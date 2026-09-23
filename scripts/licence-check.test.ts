import { describe, expect, it } from 'vitest';
import { allowed, satisfiable } from './licence-check.js';

describe('the licence allowlist', () => {
  it('passes permissive licences and expressions made of them', () => {
    expect(satisfiable('MIT')).toBe(true);
    expect(satisfiable('(MIT OR CC0-1.0)')).toBe(true);
    expect(satisfiable('(MIT AND Zlib)')).toBe(true);
  });

  it('refuses copyleft, even as one half of an AND', () => {
    expect(satisfiable('GPL-3.0-only')).toBe(false);
    expect(satisfiable('AGPL-3.0-or-later')).toBe(false);
    expect(satisfiable('LGPL-2.1')).toBe(false);
    expect(satisfiable('(MIT AND GPL-2.0)')).toBe(false);
  });

  it('accepts a dual licence when one side is allowed', () => {
    expect(satisfiable('(GPL-2.0 OR MIT)')).toBe(true);
  });

  it('refuses what it does not recognise, rather than waving it through', () => {
    expect(satisfiable('UNKNOWN')).toBe(false);
    expect(satisfiable('SEE LICENSE IN LICENSE.md')).toBe(false);
  });

  it('allows a named build tool, and not its licence for anybody else', () => {
    expect(satisfiable('MIT-0')).toBe(true);
    expect(allowed('WTFPL', 'truncate-utf8-bytes')).toBe(true);
    expect(allowed('WTFPL', 'some-other-package')).toBe(false);
  });
});
