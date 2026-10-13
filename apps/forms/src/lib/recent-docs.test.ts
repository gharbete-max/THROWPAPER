import { describe, expect, it } from 'vitest';
import { addRecent, parseRecent, RECENT_MAX, type Recent } from './recent-docs.js';

const entry = (name: string, size = 10): Recent => ({
  name,
  kind: 'pdf',
  size,
  at: '2026-10-14T10:00:00Z',
});

describe('the recent documents list', () => {
  it('puts the newest first', () => {
    expect(addRecent([entry('a')], entry('b')).map((r) => r.name)).toEqual(['b', 'a']);
  });
  it('moves a document opened again to the top instead of listing it twice', () => {
    const list = addRecent(addRecent([], entry('a')), entry('b'));
    expect(addRecent(list, entry('a')).map((r) => r.name)).toEqual(['a', 'b']);
  });
  it('treats the same name with another size as another document', () => {
    expect(addRecent([entry('a', 1)], entry('a', 2))).toHaveLength(2);
  });
  it('keeps at most RECENT_MAX', () => {
    let list: Recent[] = [];
    for (let i = 0; i < RECENT_MAX + 3; i += 1) list = addRecent(list, entry(`f${i}`));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]!.name).toBe(`f${RECENT_MAX + 2}`);
  });
  it('reads garbage as an empty list and drops malformed rows', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{not json')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    const stored = JSON.stringify([entry('ok'), { name: 3 }, { ...entry('x'), kind: 'exe' }]);
    expect(parseRecent(stored)).toEqual([entry('ok')]);
  });
});
