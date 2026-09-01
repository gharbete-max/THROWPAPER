import { describe, expect, it } from 'vitest';
import { checkImage, contentTypeOf, MAX_IMAGE_BYTES } from './image.js';

/** Real signatures, so these are the bytes a browser would actually send. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a', 'ascii');

function webp(): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(8, 4);
  buffer.write('WEBP', 8, 'ascii');
  return buffer;
}

describe('what may be uploaded', () => {
  it.each([
    ['PNG', PNG, 'png'],
    ['JPEG', JPEG, 'jpeg'],
    ['WebP', webp(), 'webp'],
    ['GIF', GIF, 'gif'],
  ])('accepts a %s by its signature', (_label, bytes, format) => {
    expect(checkImage(bytes)).toEqual({ ok: true, format });
  });

  /**
   * The whole point of reading the bytes. A file named `logo.png` and announced as `image/png`,
   * containing HTML, is a stored cross-site scripting attack once it is served from this origin.
   */
  it('refuses HTML however it is named or announced', () => {
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>', 'utf8');
    expect(checkImage(html)).toMatchObject({ ok: false, code: 'unsupported-format' });
  });

  it('refuses SVG, and says why rather than looking broken', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');
    const result = checkImage(svg);

    expect(result).toMatchObject({ ok: false, code: 'svg-not-supported' });
    // The message has to name a way forward: somebody with only an SVG logo needs to know what to do.
    if (!result.ok) expect(result.message).toMatch(/PNG/);
  });

  it.each([
    ['a byte-order mark and whitespace', '\uFEFF\n  <svg xmlns="x"></svg>'],
    ['an XML declaration first', '<?xml version="1.0"?><svg xmlns="x"></svg>'],
    ['a doctype', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg/>'],
    ['upper case', '<SVG XMLNS="x"></SVG>'],
  ])('still recognises SVG with %s, as a real file from a design tool has', (_label, source) => {
    expect(checkImage(Buffer.from(source, 'utf8'))).toMatchObject({ code: 'svg-not-supported' });
  });

  it('refuses an empty file', () => {
    expect(checkImage(Buffer.alloc(0))).toMatchObject({ ok: false, code: 'empty' });
  });

  it('refuses one byte over the limit and accepts one byte under it', () => {
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(checkImage(tooBig)).toMatchObject({ ok: false, code: 'too-large' });

    const justUnder = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES - PNG.byteLength)]);
    expect(checkImage(justUnder)).toMatchObject({ ok: true });
  });

  it('is not fooled by a signature that appears later in the file', () => {
    // A polyglot: HTML first, PNG magic further in. Only the start of the file counts.
    const polyglot = Buffer.concat([Buffer.from('<script>x</script>', 'utf8'), PNG]);
    expect(checkImage(polyglot)).toMatchObject({ ok: false });
  });

  it('refuses a truncated signature', () => {
    expect(checkImage(PNG.subarray(0, 4))).toMatchObject({ ok: false });
    expect(checkImage(Buffer.from('RIFF', 'ascii'))).toMatchObject({ ok: false });
  });

  it('serves each format as its own type', () => {
    expect(contentTypeOf('png')).toBe('image/png');
    expect(contentTypeOf('jpeg')).toBe('image/jpeg');
    expect(contentTypeOf('webp')).toBe('image/webp');
    expect(contentTypeOf('gif')).toBe('image/gif');
  });
});
