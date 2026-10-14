import { describe, expect, it } from 'vitest';
import {
  BOOK_KEY,
  BOOK_LIMIT,
  clearBook,
  forget,
  loadBook,
  remember,
  suggest,
} from './address-book.js';

/** An in-memory stand-in for localStorage. */
function memory(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [[BOOK_KEY, initial]]);
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

const addresses = (store: ReturnType<typeof memory>) => loadBook(store).map((e) => e.address);

describe('the address book', () => {
  it('remembers what was used, newest first, one entry per address whatever its capitals', () => {
    const store = memory();
    remember(['Asa@Example.com', 'bo@example.com'], 1, store);
    remember(['asa@example.com'], 2, store);
    expect(addresses(store)).toEqual(['asa@example.com', 'bo@example.com']);
  });

  it('ignores what is not an address', () => {
    const store = memory();
    remember(['', 'nobody'], 1, store);
    expect(store.items.size).toBe(0);
  });

  it('forgets one, and all', () => {
    const store = memory();
    remember(['a@x.se', 'b@x.se'], 1, store);
    forget('A@x.se', store);
    expect(addresses(store)).toEqual(['b@x.se']);
    clearBook(store);
    expect(store.items.has(BOOK_KEY)).toBe(false);
    expect(loadBook(store)).toEqual([]);
  });

  it('keeps at most the limit, dropping the least recently used', () => {
    const store = memory();
    for (let i = 0; i < BOOK_LIMIT + 5; i += 1) remember([`p${i}@x.se`], i, store);
    const book = addresses(store);
    expect(book).toHaveLength(BOOK_LIMIT);
    expect(book[0]).toBe(`p${BOOK_LIMIT + 4}@x.se`);
    expect(book).not.toContain('p0@x.se');
  });

  it('is empty, not broken, when storage is missing, full, or holds rubbish', () => {
    expect(loadBook(null)).toEqual([]);
    expect(loadBook(memory('{not json'))).toEqual([]);
    expect(loadBook(memory('{"a":1}'))).toEqual([]);
    expect(loadBook(memory('[1,{"address":"a@x.se","last":1},{"address":3}]'))).toEqual([
      { address: 'a@x.se', last: 1 },
    ]);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => remember(['a@x.se'], 1, full)).not.toThrow();
    expect(() => clearBook(full)).not.toThrow();
  });
});

describe('suggest', () => {
  const book = [
    { address: 'maria@firma.se', last: 5 },
    { address: 'anna@maria.se', last: 4 },
    { address: 'mats@firma.se', last: 3 },
    { address: 'x@y.se', last: 2 },
  ];

  it.each([
    ['', []],
    ['mar', ['maria@firma.se', 'anna@maria.se']],
    ['MA', ['maria@firma.se', 'mats@firma.se', 'anna@maria.se']],
    ['firma', ['maria@firma.se', 'mats@firma.se']],
    ['x@y.se', []],
    ['zzz', []],
  ])('%j -> %j', (typed, expected) => {
    expect(suggest(book, typed)).toEqual(expected);
  });

  it('offers at most the limit', () => {
    expect(suggest(book, 'a', 2)).toHaveLength(2);
  });
});
