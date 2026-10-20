import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupFilter } from './backup.js';

describe('the backup', () => {
  const keep = backupFilter();

  it('leaves out the keys files of Forms and of Sign', () => {
    expect(keep(join('data', 'workspace', 'secrets.json'))).toBe(false);
    expect(keep(join('data', 'workspace', 'sign', 'secrets.json'))).toBe(false);
  });

  it('copies everything else', () => {
    expect(keep(join('data', 'workspace'))).toBe(true);
    expect(keep(join('data', 'workspace', 'forms', 'pgdata', 'PG_VERSION'))).toBe(true);
  });
});
