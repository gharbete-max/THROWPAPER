import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';
import { buildMimeMessage } from './ses.js';
import type { MailProvider, OutboundMail } from './provider.js';

/**
 * Direct SMTP — `CLAUDE.md` rule 2's fallback, and the desktop edition's way out (ADR 0016).
 *
 * The message is the same MIME `ses.ts` builds, byte for byte, handed to nodemailer as a raw
 * message with an explicit envelope. So the confirmation a desktop sends through somebody's own
 * mail server is the confirmation the hosted product sends through SES, attachment and all; only
 * the last hop differs.
 *
 * Sending-domain verification still applies (`send-job.ts`): SMTP is a real provider, and a
 * domain without SPF, DKIM and DMARC lands in spam whoever carries it.
 */
export interface SmtpOptions {
  host: string;
  port: number;
  /** `true` for implicit TLS (465). Otherwise STARTTLS is required, never optional. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  /** Injected by the tests; nodemailer's own transport otherwise. */
  transport?: { sendMail(message: SmtpMessage): Promise<{ messageId?: string }> };
}

export interface SmtpMessage {
  envelope: { from: string; to: string[] };
  raw: string;
}

export function createSmtpMailProvider(options: SmtpOptions): MailProvider {
  const transport =
    options.transport ??
    createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      // Refuse to send credentials or recipient data in clear text on a plain port.
      requireTLS: !options.secure,
      ...(options.user ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
    });

  return {
    name: 'smtp',
    async send(mail: OutboundMail) {
      const from = mail.from ?? options.from;
      try {
        const info = await transport.sendMail({
          envelope: { from, to: [mail.to] },
          raw: buildMimeMessage({ ...mail, from }),
        });
        return { messageId: info.messageId ?? `smtp-${randomUUID()}` };
      } catch (error) {
        throw new Error(
          `SMTP server ${options.host}:${options.port} refused the message: ${(error as Error).message}`,
        );
      }
    },
  };
}

/**
 * Test mode for mail, on a machine: every message becomes an `.eml` file in a folder.
 *
 * `CLAUDE.md` rule 7 wants a test mode for every outbound action. The console provider logs, which
 * a desktop user never sees; this writes something they can double-click and read in their own mail
 * program — attachments included, because it is the exact MIME a real send would carry. It is the
 * desktop's default until somebody configures SMTP and turns test mode off.
 */
export function createOutboxMailProvider(options: {
  directory: string;
  from: string;
}): MailProvider {
  return {
    name: 'outbox',
    async send(mail: OutboundMail) {
      const from = mail.from ?? options.from;
      await mkdir(options.directory, { recursive: true });
      const messageId = `outbox-${Date.now()}-${randomUUID().slice(0, 8)}`;
      // Recipient in the name so a folder of fifty is scannable; everything but [a-z0-9@._-] dropped.
      const safeTo = mail.to.toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
      await writeFile(
        join(options.directory, `${messageId}_${safeTo}.eml`),
        buildMimeMessage({ ...mail, from }),
        'utf8',
      );
      return { messageId };
    },
  };
}
