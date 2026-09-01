/**
 * The mail seam, widened.
 *
 * Phase 2 shipped a `MailTransport` carrying `{ to, subject, text }` — enough for a magic link,
 * not enough for a branded email with a PDF attached. This is the `MailProvider` interface
 * `SPEC-mailer.md` §6 asks for: one place a real provider plugs in, with bounce and complaint
 * webhooks arriving behind the same boundary in B11.
 */
export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutboundMail {
  to: string;
  /** Omitted by callers that do not care; the provider fills in the configured sender. */
  from?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  /** Retries must not double-send. Mirrors the contract's requirement in docs/CONTRACT.md §1.1. */
  idempotencyKey?: string;
}

export interface SentMail {
  messageId: string;
}

export interface MailProvider {
  readonly name: string;
  send(mail: OutboundMail): Promise<SentMail>;
}

/** Kept for the magic link and resume link, which only ever send plain text. */
export function createConsoleMailProvider(log: (message: string) => void): MailProvider {
  return {
    name: 'console',
    async send(mail) {
      log(
        `\n--- mail (console provider) ---\nto: ${mail.to}\nsubject: ${mail.subject}\n` +
          `${mail.text}\n` +
          (mail.attachments?.length
            ? `attachments: ${mail.attachments.map((a) => a.filename).join(', ')}\n`
            : '') +
          '---\n',
      );
      return { messageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
    },
  };
}

export function createMemoryMailProvider(): MailProvider & { sent: OutboundMail[] } {
  const sent: OutboundMail[] = [];
  return {
    name: 'memory',
    sent,
    async send(mail) {
      sent.push(mail);
      return { messageId: `memory-${sent.length}` };
    },
  };
}

/** Refuses everything. Used when no provider is configured, so a misconfiguration is loud. */
export function createUnconfiguredMailProvider(): MailProvider {
  return {
    name: 'unconfigured',
    async send() {
      throw new Error(
        'No mail provider is configured. Set MAIL_PROVIDER=ses and the SES settings, or console for development.',
      );
    },
  };
}
