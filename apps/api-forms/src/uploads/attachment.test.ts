import { describe, expect, it } from 'vitest';
import { checkAttachment } from './attachment.js';

/**
 * What a stranger may put on our disk, decided by looking at the bytes.
 *
 * The filename and the declared content type are both written by whoever is uploading, so neither
 * is evidence of anything. These tests are about the one thing that is.
 */
const png = () => Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\n'), zeros(16)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), zeros(16)]);
const gif = () => Buffer.concat([Buffer.from('GIF89a'), zeros(16)]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), zeros(4), Buffer.from('WEBP'), zeros(16)]);
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), zeros(16)]);

function zeros(count: number) {
  return Buffer.alloc(count);
}

describe('deciding what an attachment is', () => {
  it.each([
    ['png', png()],
    ['jpg', jpeg()],
    ['gif', gif()],
    ['webp', webp()],
    ['pdf', pdf()],
  ])('recognises a %s by its first bytes', (extension, bytes) => {
    const checked = checkAttachment(bytes, 'both');
    expect(checked.ok && checked.extension).toBe(extension);
  });

  /**
   * The attack this exists to stop: an HTML document called `cv.pdf`, announced as
   * `application/pdf`. Served back from this origin it would be a stored cross-site scripting
   * hole — so it never gets stored, and the download route serves an attachment regardless.
   */
  it('refuses HTML however it is named or announced', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(checkAttachment(html, 'both')).toEqual({ ok: false, code: 'unsupported-format' });
  });

  it('refuses SVG, and says so separately', () => {
    // An SVG is a document that can carry script. The distinct code lets the message explain
    // rather than leaving somebody to conclude the upload is broken.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(checkAttachment(svg, 'both')).toEqual({ ok: false, code: 'svg-not-supported' });
    const declared = Buffer.from('<?xml version="1.0"?><svg><script/></svg>');
    expect(checkAttachment(declared, 'both')).toEqual({ ok: false, code: 'svg-not-supported' });
  });

  it('refuses an archive, which is neither an image nor a document', () => {
    const zip = Buffer.concat([Buffer.from('PK'), zeros(16)]);
    expect(checkAttachment(zip, 'both')).toEqual({ ok: false, code: 'unsupported-format' });
  });

  it('refuses an empty file rather than storing nothing', () => {
    expect(checkAttachment(Buffer.alloc(0), 'both')).toEqual({ ok: false, code: 'empty' });
  });

  it('honours the size cap the question set', () => {
    expect(checkAttachment(pdf(), 'both', 8)).toEqual({ ok: false, code: 'too-large' });
  });

  it('honours what the question actually asked for', () => {
    // A recognised file that is simply the wrong kind gets its own answer, so the message can say
    // "this question wants a photograph" rather than "unsupported".
    expect(checkAttachment(pdf(), 'image')).toEqual({ ok: false, code: 'not-accepted-here' });
    expect(checkAttachment(png(), 'pdf')).toEqual({ ok: false, code: 'not-accepted-here' });
    expect(checkAttachment(png(), 'image').ok).toBe(true);
    expect(checkAttachment(pdf(), 'pdf').ok).toBe(true);
  });

  it('never trusts a file too short to identify', () => {
    expect(checkAttachment(Buffer.from('%PDF'), 'both')).toEqual({
      ok: false,
      code: 'unsupported-format',
    });
  });
});
