import { describe, expect, it } from 'vitest';
import { buildMimeMessage } from './ses.js';

/**
 * A subject built from something a stranger typed — the public contact form's name field — must not
 * be able to end the header and write the rest of the message.
 */
describe('header injection', () => {
  const attack = 'x\r\nContent-Type: text/html\r\n\r\n<a href="https://evil.example">Pay here</a>';

  it('keeps a subject with line breaks in it on one line', () => {
    const message = buildMimeMessage({
      from: 'Demo AB <hello@demo.example>',
      to: 'member@example.com',
      subject: attack,
      text: 'Hej',
    });
    const [head] = message.split('\r\n\r\n');
    const lines = head!.split('\r\n');
    expect(lines.filter((line) => line.startsWith('Subject:'))).toHaveLength(1);
    // Nothing the attacker wrote became a header of its own.
    expect(lines.filter((line) => /^Content-Type: text\/html/.test(line))).toHaveLength(0);
    expect(message).not.toContain('\r\n<a href');
  });

  it('keeps To and an attachment name on one line, and a quote out of the filename', () => {
    const message = buildMimeMessage({
      from: 'hello@demo.example',
      to: 'a@example.com\r\nBcc: everyone@example.com',
      subject: 'Hej',
      text: 'Hej',
      attachments: [
        {
          filename: 'kort"\r\nX-Evil: 1.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('%PDF-'),
        },
      ],
    });
    expect(message).not.toMatch(/\r\nBcc:/);
    expect(message).not.toMatch(/\r\nX-Evil:/);
    expect(message).toContain('filename="kort_ X-Evil: 1.pdf"');
  });

  it('still encodes a Swedish subject', () => {
    const message = buildMimeMessage({
      from: 'hello@demo.example',
      to: 'a@example.com',
      subject: 'Välkommen till Vårmötet',
      text: 'Hej',
    });
    expect(message).toContain('Subject: =?UTF-8?B?');
  });
});
