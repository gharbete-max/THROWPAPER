/**
 * Phase 2 defined `MailTransport` here for the magic link. Phase 4b widened it into `MailProvider`
 * (from, html, attachments, a returned messageId) so a branded email with a PDF can go through the
 * same seam. This file re-exports the new names so there is one mail interface, not two.
 */
export type { MailAttachment, MailProvider, OutboundMail, SentMail } from '../mail/provider.js';
export {
  createConsoleMailProvider,
  createMemoryMailProvider,
  createUnconfiguredMailProvider,
} from '../mail/provider.js';

export type { MailProvider as MailTransport } from '../mail/provider.js';
