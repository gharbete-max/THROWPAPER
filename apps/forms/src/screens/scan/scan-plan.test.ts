import { describe, expect, it } from 'vitest';
import { movePage, pagesOfFile, removePage, requestOf, turnPage } from './scan-plan.js';

describe('the pages of a file', () => {
  it('start in order, unturned, each with an id of its own', () => {
    const pages = pagesOfFile(2, 3);
    expect(pages.map((p) => [p.file, p.page, p.turn])).toEqual([
      [2, 0, 0],
      [2, 1, 0],
      [2, 2, 0],
    ]);
    expect(new Set(pages.map((p) => p.id)).size).toBe(3);
  });
});

describe('moving a page', () => {
  const pages = pagesOfFile(0, 3);
  it('earlier or later by one place', () => {
    expect(movePage(pages, pages[1]!.id, -1).map((p) => p.page)).toEqual([1, 0, 2]);
    expect(movePage(pages, pages[1]!.id, 1).map((p) => p.page)).toEqual([0, 2, 1]);
  });
  it('and not past either end', () => {
    expect(movePage(pages, pages[0]!.id, -1)).toEqual(pages);
    expect(movePage(pages, pages[2]!.id, 1)).toEqual(pages);
  });
  it('without changing the list it was given', () => {
    movePage(pages, pages[1]!.id, 1);
    expect(pages.map((p) => p.page)).toEqual([0, 1, 2]);
  });
});

describe('turning a page', () => {
  it('a quarter turn each time, and round again after four', () => {
    let pages = pagesOfFile(0, 1);
    const id = pages[0]!.id;
    const turns = [] as number[];
    for (let i = 0; i < 5; i += 1) {
      pages = turnPage(pages, id);
      turns.push(pages[0]!.turn);
    }
    expect(turns).toEqual([90, 180, 270, 0, 90]);
  });
});

describe('removing a page', () => {
  it('takes only that page out', () => {
    const pages = pagesOfFile(0, 3);
    expect(removePage(pages, pages[1]!.id).map((p) => p.page)).toEqual([0, 2]);
  });
});

describe('the request', () => {
  it('sends only the files still used, and renumbers them in the order they first appear', () => {
    const a = new File(['a'], 'a.pdf');
    const b = new File(['b'], 'b.pdf');
    const c = new File(['c'], 'c.pdf');
    const pages = [...pagesOfFile(2, 1), ...pagesOfFile(0, 2)];
    const turned = turnPage(pages, pages[1]!.id);
    const request = requestOf(turned, [a, b, c]);
    expect(request.files).toEqual([c, a]);
    expect(request.plan).toEqual([
      { file: 0, page: 0, rotate: 0 },
      { file: 1, page: 0, rotate: 90 },
      { file: 1, page: 1, rotate: 0 },
    ]);
  });
});
