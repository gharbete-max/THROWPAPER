import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * The unsubscribe link in a campaign (`campaign.ts`), and the words on the page it opens.
 *
 * The link holds an organisation and an address, signed, and no expiry: a campaign opened a year
 * later must still be able to stop. It is its own key, derived from `DOCUMENT_SIGNING_SECRET`
 * under a purpose label, so it can never verify as a download link or a finished-document token.
 * Shape: `<organisationId>.<base64url address>.<base64url HMAC-SHA256>`.
 *
 * The page says the minimum a page must: a button, then that it is done, or that the link is not
 * valid. Those are functional labels, in all twelve languages; the sender's own words about who
 * they are and why the recipient got the mail are the footer the sender typed (rule 8), never here.
 */
const HKDF_INFO = 'throwpaper/campaign-unsubscribe/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function deriveUnsubscribeKey(documentSigningSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(documentSigningSecret),
      Buffer.alloc(0),
      Buffer.from(HKDF_INFO),
      32,
    ),
  );
}

const mac = (organisationId: string, address: string, key: Buffer) =>
  createHmac('sha256', key).update(`${organisationId}\n${address}`).digest('base64url');

export function signUnsubscribeToken(organisationId: string, email: string, key: Buffer): string {
  const address = email.trim().toLowerCase();
  return `${organisationId}.${Buffer.from(address).toString('base64url')}.${mac(organisationId, address, key)}`;
}

export function verifyUnsubscribeToken(
  token: string,
  key: Buffer,
): { organisationId: string; email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [organisationId, encoded, provided] = parts as [string, string, string];
  if (!UUID.test(organisationId) || encoded.length > 512 || provided.length !== 43) return null;
  const email = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(mac(organisationId, email, key));
  const given = Buffer.from(provided);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { organisationId, email };
}

/** The headers that make a mail program offer its own Unsubscribe button (RFC 2369, RFC 8058). */
export const unsubscribeHeaders = (url: string): Record<string, string> => ({
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

const COPY = {
  'en-GB': {
    action: 'Unsubscribe',
    done: 'Done. {email} will get no more campaign emails from {organisation}.',
    invalid: 'This link is not valid.',
  },
  'sv-SE': {
    action: 'Avsluta prenumeration',
    done: 'Klart. {email} får inga fler utskick från {organisation}.',
    invalid: 'Länken är inte giltig.',
  },
  'da-DK': {
    action: 'Afmeld',
    done: 'Færdig. {email} får ikke flere udsendelser fra {organisation}.',
    invalid: 'Linket er ikke gyldigt.',
  },
  'nb-NO': {
    action: 'Meld deg av',
    done: 'Ferdig. {email} får ikke flere utsendelser fra {organisation}.',
    invalid: 'Lenken er ikke gyldig.',
  },
  'fi-FI': {
    action: 'Peruuta tilaus',
    done: 'Valmis. {email} ei saa enää kampanjaviestejä lähettäjältä {organisation}.',
    invalid: 'Linkki ei ole kelvollinen.',
  },
  'is-IS': {
    action: 'Afskrá',
    done: 'Búið. {email} fær ekki fleiri fjöldapósta frá {organisation}.',
    invalid: 'Hlekkurinn er ekki gildur.',
  },
  'fr-FR': {
    action: 'Se désabonner',
    done: 'C’est fait. {email} ne recevra plus d’envois de {organisation}.',
    invalid: 'Ce lien n’est pas valide.',
  },
  'de-DE': {
    action: 'Abmelden',
    done: 'Erledigt. {email} erhält keine weiteren Rundmails von {organisation}.',
    invalid: 'Dieser Link ist nicht gültig.',
  },
  'es-ES': {
    action: 'Darse de baja',
    done: 'Hecho. {email} no recibirá más envíos de {organisation}.',
    invalid: 'Este enlace no es válido.',
  },
  'zh-CN': {
    action: '退订',
    done: '完成。{email} 将不再收到 {organisation} 的群发邮件。',
    invalid: '此链接无效。',
  },
  'ja-JP': {
    action: '配信を停止',
    done: '完了しました。{email} には今後 {organisation} からの一斉メールは送信されません。',
    invalid: 'このリンクは無効です。',
  },
  'ru-RU': {
    action: 'Отписаться',
    done: 'Готово. {email} больше не получит рассылок от {organisation}.',
    invalid: 'Эта ссылка недействительна.',
  },
} as const;

export const UNSUBSCRIBE_COPY_LOCALES = Object.keys(COPY);

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const copyFor = (locale: string) => COPY[locale as keyof typeof COPY] ?? COPY['en-GB'];

type Page =
  | { kind: 'ask'; email: string; organisation: string }
  | { kind: 'done'; email: string; organisation: string }
  | { kind: 'invalid' };

/**
 * One small page. A GET only asks (mail scanners follow links, and a link followed by a robot must
 * not unsubscribe anybody); the button posts, and so does a mail program's one-click.
 */
export function unsubscribePage(locale: string, page: Page): string {
  const copy = copyFor(locale);
  const lang = locale in COPY ? locale : 'en-GB';
  const body =
    page.kind === 'invalid'
      ? `<p>${escape(copy.invalid)}</p>`
      : page.kind === 'done'
        ? `<p>${escape(copy.done.replace('{email}', () => page.email).replace('{organisation}', () => page.organisation))}</p>`
        : `<p>${escape(page.email)}</p><form method="post"><button type="submit">${escape(copy.action)}</button></form>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(copy.action)}</title></head><body><main><h1>${escape(copy.action)}</h1>${body}</main></body></html>`;
}
