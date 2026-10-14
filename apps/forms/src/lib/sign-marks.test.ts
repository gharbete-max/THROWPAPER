import { describe, expect, it } from 'vitest';
import {
  forgetAllMarks,
  forgetMark,
  inkBounds,
  loadMarks,
  saveMark,
  STORE_NAME,
  type MarkStorage,
  type SavedMark,
} from './sign-marks.js';

function memory(): MarkStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const mark: SavedMark = { png: 'data:image/png;base64,iVBORw0KGgo=', width: 300, height: 100 };

describe('the signature and initials kept on this computer', () => {
  it('start with nothing', () => {
    expect(loadMarks(memory())).toEqual({});
  });

  it('keep each one separately and give them back', () => {
    const storage = memory();
    expect(saveMark('signature', mark, storage)).toBe(true);
    expect(saveMark('initials', { ...mark, width: 80 }, storage)).toBe(true);
    expect(loadMarks(storage)).toEqual({ signature: mark, initials: { ...mark, width: 80 } });
  });

  it('forget one and leave the other, then forget everything and leave no key behind', () => {
    const storage = memory();
    saveMark('signature', mark, storage);
    saveMark('initials', mark, storage);
    expect(forgetMark('signature', storage)).toBe(true);
    expect(loadMarks(storage)).toEqual({ initials: mark });
    expect(forgetAllMarks(storage)).toBe(true);
    expect(storage.map.has(STORE_NAME)).toBe(false);
  });

  it('refuse what is not a picture of a mark', () => {
    const storage = memory();
    expect(saveMark('signature', { ...mark, png: 'https://example.test/x.png' }, storage)).toBe(
      false,
    );
    expect(saveMark('signature', { ...mark, width: 0 }, storage)).toBe(false);
    const huge = { ...mark, png: `data:image/png;base64,${'A'.repeat(400_000)}` };
    expect(saveMark('signature', huge, storage)).toBe(false);
    expect(loadMarks(storage)).toEqual({});
  });

  it('read damaged storage as empty rather than failing', () => {
    const storage = memory();
    storage.setItem(STORE_NAME, '{not json');
    expect(loadMarks(storage)).toEqual({});
    storage.setItem(STORE_NAME, JSON.stringify({ signature: { png: 7 }, initials: mark }));
    expect(loadMarks(storage)).toEqual({ initials: mark });
  });

  it('work without storage, and when storage throws', () => {
    expect(loadMarks(null)).toEqual({});
    expect(saveMark('signature', mark, null)).toBe(false);
    const broken: MarkStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadMarks(broken)).toEqual({});
    expect(saveMark('signature', mark, broken)).toBe(false);
    expect(forgetAllMarks(broken)).toBe(false);
  });
});

describe('the box around the ink', () => {
  const picture = (width: number, height: number, dots: Array<[number, number]>) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of dots) data[(y * width + x) * 4 + 3] = 255;
    return data;
  };

  it('is the smallest box holding every inked pixel, grown by the padding and kept inside', () => {
    const data = picture(20, 10, [
      [4, 3],
      [9, 6],
    ]);
    expect(inkBounds(data, 20, 10)).toEqual({ x: 4, y: 3, width: 6, height: 4 });
    expect(inkBounds(data, 20, 10, 2)).toEqual({ x: 2, y: 1, width: 10, height: 8 });
    expect(inkBounds(picture(20, 10, [[0, 0]]), 20, 10, 5)).toEqual({
      x: 0,
      y: 0,
      width: 6,
      height: 6,
    });
  });

  it('is nothing for a blank picture', () => {
    expect(inkBounds(picture(8, 8, []), 8, 8)).toBeNull();
  });
});
