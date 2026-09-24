import { describe, expect, it } from 'vitest';
import { canShareFile, copyableDraft, mailtoHref, shareFile } from './email-handoff.js';

const text = {
  subject: 'Vårmötet 2026 — K7M2QX',
  body: 'Bifogat: Vårmötet-2026-K7M2QX.pdf\nReferens: K7M2QX',
};

describe('mailto', () => {
  it('sets no recipient: the person chooses who it goes to', () => {
    expect(mailtoHref(text).startsWith('mailto:?')).toBe(true);
  });

  it('encodes as RFC 6068 asks: %20 for spaces, CRLF for line breaks, å ä ö as UTF-8', () => {
    const href = mailtoHref(text);
    expect(href).toContain('subject=V%C3%A5rm%C3%B6tet%202026%20%E2%80%94%20K7M2QX');
    expect(href).toContain('%0D%0AReferens');
    expect(href).not.toContain('+');
  });

  it('carries no parameter a client could read as an attachment or extra header', () => {
    const hostile = mailtoHref({
      subject: 'x&attach=C:\\secret.txt&bcc=all@example.com',
      body: 'y?cc=z',
    });
    const params = new URLSearchParams(hostile.slice('mailto:?'.length));
    expect([...params.keys()].sort()).toEqual(['body', 'subject']);
    expect(params.get('subject')).toBe('x&attach=C:\\secret.txt&bcc=all@example.com');
  });

  it('escapes the characters encodeURIComponent leaves alone', () => {
    expect(mailtoHref({ subject: "it's (1)!", body: '*' })).toBe(
      'mailto:?subject=it%27s%20%281%29%21&body=%2A',
    );
  });
});

describe('the copyable draft', () => {
  it('is the subject, a blank line, then the body', () => {
    expect(copyableDraft(text)).toBe(`${text.subject}\n\n${text.body}`);
  });
});

describe('sharing the file', () => {
  const file = new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' });

  it('is offered only where the browser says it can share this file', () => {
    expect(canShareFile(file, undefined)).toBe(false);
    expect(canShareFile(file, {} as Navigator)).toBe(false);
    expect(
      canShareFile(file, { share: async () => {}, canShare: () => false } as unknown as Navigator),
    ).toBe(false);
    expect(
      canShareFile(file, { share: async () => {}, canShare: () => true } as unknown as Navigator),
    ).toBe(true);
    expect(
      canShareFile(file, {
        share: async () => {},
        canShare: () => {
          throw new TypeError('no');
        },
      } as unknown as Navigator),
    ).toBe(false);
  });

  it('treats closing the share sheet as a choice, not a failure', async () => {
    const shared: ShareData[] = [];
    const ok = { share: async (data: ShareData) => void shared.push(data) } as unknown as Navigator;
    expect(await shareFile(file, text, ok)).toBe('shared');
    expect(shared[0]!.files).toEqual([file]);

    const closed = {
      share: async () => {
        throw new DOMException('closed', 'AbortError');
      },
    } as unknown as Navigator;
    expect(await shareFile(file, text, closed)).toBe('cancelled');

    const broken = {
      share: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    } as unknown as Navigator;
    expect(await shareFile(file, text, broken)).toBe('failed');
  });
});
