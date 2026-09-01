import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { MailAttachment, MailProvider, OutboundMail } from './provider.js';

/**
 * Amazon SES, `eu-north-1` (Stockholm) — START-HERE decision 4. Recipient data stays in Sweden.
 *
 * Two things worth knowing about SES specifically:
 *
 * 1. A new account is **sandboxed**: it will only deliver to addresses you have verified, until
 *    AWS grants production access on request. START-HERE's phase 4 checkpoint — does mail land in
 *    real inboxes — cannot be met from the sandbox, and the error below says so rather than
 *    leaving somebody guessing.
 * 2. There is no attachment field in the simple API, so anything with an attachment has to be
 *    assembled as raw MIME. That is what buildMimeMessage does.
 */
export interface SesOptions {
  region: string;
  from: string;
  /** Optional configuration set, for the delivery event stream B11 will consume. */
  configurationSet?: string;
  client?: Pick<SESv2Client, 'send'>;
}

export function createSesMailProvider(options: SesOptions): MailProvider {
  const client = options.client ?? new SESv2Client({ region: options.region });

  return {
    name: 'ses',
    async send(mail: OutboundMail) {
      const from = mail.from ?? options.from;

      const command = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [mail.to] },
        ConfigurationSetName: options.configurationSet,
        Content: {
          Raw: { Data: Buffer.from(buildMimeMessage({ ...mail, from })) },
        },
      });

      try {
        const response = await client.send(command as never);
        const messageId = (response as { MessageId?: string }).MessageId;
        if (!messageId) throw new Error('SES accepted the message but returned no MessageId');
        return { messageId };
      } catch (error) {
        throw new Error(`SES rejected the message: ${describeSesError(error)}`);
      }
    },
  };
}

function describeSesError(error: unknown): string {
  const named = error as { name?: string; message?: string };
  if (named?.name === 'MessageRejected' && /not verified/i.test(named.message ?? '')) {
    return `${named.message} — this account is probably still in the SES sandbox, which only delivers to verified addresses. Request production access in the SES console.`;
  }
  return named?.message ?? String(error);
}

/**
 * A minimal MIME message.
 *
 * `multipart/mixed` wrapping a `multipart/alternative` when there are attachments, which is the
 * shape mail clients expect: text and HTML as alternatives of each other, attachments alongside.
 */
export function buildMimeMessage(mail: OutboundMail & { from: string }): string {
  const boundaryMixed = `mixed_${randomBoundary()}`;
  const boundaryAlt = `alt_${randomBoundary()}`;
  const attachments = mail.attachments ?? [];

  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    // Encoded, because a Swedish subject line is not ASCII and a raw one arrives as mojibake.
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
  ];

  const alternative = [
    `Content-Type: text/plain; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(mail.text, 'utf8').toString('base64')),
  ];

  const altPart = mail.html
    ? [
        `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
        '',
        `--${boundaryAlt}`,
        ...alternative,
        `--${boundaryAlt}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrap(Buffer.from(mail.html, 'utf8').toString('base64')),
        `--${boundaryAlt}--`,
      ]
    : alternative;

  if (attachments.length === 0) {
    return [...headers, ...altPart, ''].join('\r\n');
  }

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
    '',
    `--${boundaryMixed}`,
    ...altPart,
    ...attachments.flatMap((attachment) => attachmentPart(boundaryMixed, attachment)),
    `--${boundaryMixed}--`,
    '',
  ].join('\r\n');
}

function attachmentPart(boundary: string, attachment: MailAttachment): string[] {
  return [
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    wrap(attachment.content.toString('base64')),
  ];
}

/** RFC 2047 encoded word, so å ä ö in a subject line survive. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Base64 bodies are wrapped at 76 characters; some servers reject longer lines. */
function wrap(value: string): string {
  return value.replace(/(.{76})/g, '$1\r\n');
}

function randomBoundary(): string {
  return Math.random().toString(36).slice(2, 12);
}
