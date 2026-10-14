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

describe('the model weights', () => {
  // licence:check reads npm packages only, so the weights' licence is held here (ADR 0023 section 3).
  it('of every distributable model are under a licence the allowlist accepts, with provenance and attribution recorded', async () => {
    const { MODEL_REGISTRY } = await import('../packages/shared/src/ai/manifest.js');
    const notices = (await import('node:fs')).readFileSync(
      new URL('../THIRD-PARTY-NOTICES.md', import.meta.url),
      'utf8',
    );
    const shipped = MODEL_REGISTRY.filter((m) => m.distributable);
    expect(shipped.length).toBeGreaterThan(0);
    for (const model of shipped) {
      expect(satisfiable(model.licence), model.id).toBe(true);
      expect(model.licenceUrl).toMatch(/^https:\/\//);
      expect(model.source).toMatch(/^https:\/\/huggingface\.co\//);
      expect(notices).toContain(model.id);
      for (const file of model.files) expect(notices).toContain(file.sha256);
    }
  });

  it('under a licence that does not allow shipping them are marked evaluation-only and never distributable', async () => {
    const { MODEL_REGISTRY } = await import('../packages/shared/src/ai/manifest.js');
    for (const model of MODEL_REGISTRY.filter((m) => !satisfiable(m.licence))) {
      expect(model.evaluationOnly, model.id).toBe(true);
      expect(model.distributable, model.id).toBe(false);
    }
  });
});
