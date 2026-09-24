import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOutboxMailProvider, createSmtpMailProvider, type SmtpMessage } from './smtp.js';

const scratch = await mkdtemp(join(tmpdir(), 'loppa-outbox-'));
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const mail = {
  to: 'Åsa@Example.com',
  subject: 'Bekräftelse — Vårmötet',
  text: 'Välkommen!',
  html: '<p>Välkommen!</p>',
  attachments: [
    { filename: 'antagning.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.7') },
  ],
};

describe('the SMTP provider', () => {
  it('hands the transport the same MIME SES would send, with an explicit envelope', async () => {
    const sent: SmtpMessage[] = [];
    const provider = createSmtpMailProvider({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'anmalan@example.com',
      transport: {
        async sendMail(message) {
          sent.push(message);
          return { messageId: '<abc@example.com>' };
        },
      },
    });

    const result = await provider.send(mail);
    expect(result.messageId).toBe('<abc@example.com>');
    expect(sent[0]?.envelope).toEqual({ from: 'anmalan@example.com', to: ['Åsa@Example.com'] });
    expect(sent[0]?.raw).toContain('antagning.pdf');
    expect(sent[0]?.raw).toMatch(/^From: anmalan@example\.com/m);
  });

  it('says which server refused, rather than a bare transport error', async () => {
    const provider = createSmtpMailProvider({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      from: 'anmalan@example.com',
      transport: {
        async sendMail() {
          throw new Error('535 Authentication failed');
        },
      },
    });
    await expect(provider.send(mail)).rejects.toThrow(
      /smtp\.example\.com:465 refused the message: 535/,
    );
  });
});

describe('the outbox provider (test mode)', () => {
  it('writes an .eml file carrying the attachment and sends nothing', async () => {
    const directory = join(scratch, 'outbox');
    const provider = createOutboxMailProvider({ directory, from: 'anmalan@example.com' });
    expect(provider.name).toBe('outbox');

    const { messageId } = await provider.send(mail);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    // Lower-cased, and the å outside the safe set replaced, so the name is valid on every disk.
    expect(files[0]).toBe(`${messageId}__sa@example.com.eml`);

    const eml = await readFile(join(directory, files[0]!), 'utf8');
    expect(eml).toContain('antagning.pdf');
    expect(eml).toMatch(/^From: anmalan@example\.com/m);
  });
});
