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
    `From: ${oneLine(mail.from)}`,
    `To: ${oneLine(mail.to)}`,
    // Encoded, because a Swedish subject line is not ASCII and a raw one arrives as mojibake.
    `Subject: ${encodeHeader(oneLine(mail.subject))}`,
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
  const filename = oneLine(attachment.filename);
  return [
    `--${boundary}`,
    `Content-Type: ${oneLine(attachment.contentType)};\r\n name="${asciiName(filename)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment;${filenameParameters(filename)}`,
    '',
    wrap(attachment.content.toString('base64')),
  ];
}

/** Inside a quoted parameter a quote or backslash would end or escape it. */
function quotable(value: string): string {
  return value.replace(/["\\]/g, '_');
}

/** The name with its accents taken off and anything else outside printable ASCII made `_`. */
function asciiName(filename: string): string {
  return quotable(
    filename
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '_'),
  );
}

/**
 * The attachment's name, as mail programs read it: RFC 2231 (`filename*`), split into continuations
 * so no header line runs long. Only that form when the name is not ASCII — a plain `filename` beside
 * it is what some readers take first (Python's own parser did) — with the plain-ASCII version left
 * in the Content-Type's old `name` for a program that knows neither.
 *
 * The admission card is named after the attendee, and the name went into the header as raw UTF-8:
 * "Björn-Ödlund-….pdf" arrived as "BjÃ¶rn-Ã–dlund-….pdf", or as an unnamed attachment, in programs
 * that read headers as the standard says. The subject was already encoded; the filename was not.
 */
function filenameParameters(filename: string): string {
  if (/^[\x20-\x7e]*$/.test(filename)) return ` filename="${quotable(filename)}"`;
  // RFC 2231 attribute-char: everything else is %XX of its UTF-8 bytes.
  const encoded = [...Buffer.from(filename, 'utf8')]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9!#$&+.^_`|~-]/.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  // At most 50 characters a piece — a line of 70 with its name — never inside a %XX escape.
  const pieces: string[] = [''];
  for (const token of encoded.match(/%[0-9A-F]{2}|[^%]/g) ?? []) {
    if (pieces[pieces.length - 1]!.length + token.length > 50) pieces.push('');
    pieces[pieces.length - 1] += token;
  }
  return pieces
    .map((piece, index) => `\r\n filename*${index}*=${index === 0 ? "UTF-8''" : ''}${piece}`)
    .join(';');
}

/**
 * A header value on one line, whatever it was given.
 *
 * Subjects are built from things people type — a contact form's name field (no sign-in needed), a
 * document's name, an event's name — and an ASCII subject went into the header as it was. A line
 * break in it ended the header: `x\r\nContent-Type: text/html\r\n\r\n<a href=…>` became a message
 * of the sender's choosing, from the organisation's verified domain. Every control character is a
 * space here, before any encoding, for every sender (SES, SMTP, the outbox).
 */
export function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]+/g, ' ');
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
