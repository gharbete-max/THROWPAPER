import { z } from 'zod';
import { Email } from './common.js';
import { BatchRow, SEND_LIMITS, SendQueued, oneLine } from './send.js';

/**
 * A campaign: one plain-text email to a list, inside Send (Documents, phase "Campaigns").
 *
 * The list is the batch list (`BatchRow`, `parseTable`, `guessColumns`); the words are the
 * sender's. Nothing here writes legal, consent or unsubscribe wording (CLAUDE.md rule 8): the
 * footer is a field the sender types, and a campaign without one that carries the unsubscribe
 * link placeholder is refused here, on the screen and on the server alike.
 *
 * Plain text, so there is nothing to track with: no pixel, no rewritten link. A message is the
 * words the sender wrote with the fields filled in.
 */

/** The footer's (and body's) stand-in for the recipient's own unsubscribe link. */
export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe}}';

/** What a list can fill in. `amount` is carried as typed: a campaign does no arithmetic. */
export const CAMPAIGN_FIELDS = ['name', 'email', 'amount', 'reference'] as const;
export type CampaignField = (typeof CAMPAIGN_FIELDS)[number];

/** `{{name}}`, or `{{name | there}}` for the word to use when the list has none. */
const TOKEN = /\{\{\s*([A-Za-z]+)\s*(?:\|([^{}]*))?\}\}/g;

const isField = (name: string): name is CampaignField =>
  (CAMPAIGN_FIELDS as readonly string[]).includes(name);

const tokens = (text: string) =>
  [...text.matchAll(TOKEN)].map(([, name, fallback]) => ({
    name: name!,
    hasFallback: (fallback ?? '').trim() !== '',
  }));

/**
 * Fills the fields from one row. An empty value takes the fallback, if one was typed; otherwise
 * it stays empty (and `checkCampaign` has already named the row). `{{unsubscribe}}` becomes
 * `unsubscribe` when given and is left as written otherwise; any other name is left as written.
 */
export function mergeCampaign(text: string, row: BatchRow, unsubscribe?: string): string {
  return text.replace(TOKEN, (whole, name: string, fallback: string | undefined) => {
    if (name === 'unsubscribe') return unsubscribe ?? whole;
    if (!isField(name)) return whole;
    return row[name].trim() || (fallback ?? '').trim();
  });
}

export const SendCampaignRequest = z.object({
  /** Made when the confirmation opened: a second press with it is the same press. */
  key: z.string().uuid(),
  /** The confirmation step, answered. A request without it queues nothing. */
  confirmed: z.literal(true),
  /** Test: everything goes to this one address instead, marked, and suppression is not applied. */
  testTo: Email.optional(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  /** Required, and the sender's own words: who sends, why they got it, how to stop it. */
  footer: z.string().max(2000),
  /** Counted against `SEND_LIMITS.campaign` by the route, which says so in words. */
  rows: z.array(BatchRow).min(1).max(5000),
});
export type SendCampaignRequest = z.infer<typeof SendCampaignRequest>;

/** What the press queued, and the addresses left out because they are on the suppression list. */
export const CampaignQueued = SendQueued.extend({ skipped: z.array(z.string()) });
export type CampaignQueued = z.infer<typeof CampaignQueued>;

export const CampaignAudienceRequest = z.object({ emails: z.array(z.string().max(320)).max(5000) });
export type CampaignAudienceRequest = z.infer<typeof CampaignAudienceRequest>;

/** Which of the addresses are on the organisation's suppression list. */
export const CampaignAudienceResponse = z.object({ suppressed: z.array(z.string()) });
export type CampaignAudienceResponse = z.infer<typeof CampaignAudienceResponse>;

export const SUPPRESSION_REASONS = ['unsubscribed', 'bounced', 'manual'] as const;
export const SuppressionReason = z.enum(SUPPRESSION_REASONS);
export type SuppressionReason = z.infer<typeof SuppressionReason>;

export const SuppressionList = z.object({
  items: z.array(z.object({ email: z.string(), reason: SuppressionReason, createdAt: z.string() })),
});
export type SuppressionList = z.infer<typeof SuppressionList>;

export const AddSuppression = z.object({
  email: Email,
  reason: z.enum(['bounced', 'manual']).default('manual'),
});

export type CampaignProblem = {
  /** The row (from 0), or `-1` for the campaign as a whole. */
  row: number;
  field: CampaignField | 'subject' | 'body' | 'footer';
  code:
    | 'bad-email'
    | 'empty-field'
    | 'unknown-field'
    | 'footer-missing'
    | 'footer-no-link'
    | 'too-many';
};

const LINK = /\{\{\s*unsubscribe\s*\}\}/;

/** An address in the form the suppression list and the idempotency key use. */
export const normaliseAddress = (email: string): string => email.trim().toLowerCase();

/** The rows with a usable address, once per address (the first), in list order. */
export function uniqueRecipients<T extends BatchRow>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const address = normaliseAddress(row.email);
    if (!Email.safeParse(address).success || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
}

/**
 * What is wrong before anything is previewed or sent: no footer, a footer that cannot unsubscribe
 * anybody, a field that does not exist, an address that is not one, a field a recipient's row
 * leaves empty where the text gave no fallback — named by row, the way a person counts them.
 */
export function checkCampaign(
  subject: string,
  body: string,
  footer: string,
  rows: readonly BatchRow[],
): CampaignProblem[] {
  const problems: CampaignProblem[] = [];
  if (rows.length > SEND_LIMITS.campaign) {
    problems.push({ row: -1, field: 'email', code: 'too-many' });
  }
  if (footer.trim() === '') problems.push({ row: -1, field: 'footer', code: 'footer-missing' });
  else if (!LINK.test(footer)) problems.push({ row: -1, field: 'footer', code: 'footer-no-link' });

  const needed = new Set<CampaignField>();
  for (const [field, text] of [
    ['subject', subject],
    ['body', body],
    ['footer', footer],
  ] as const) {
    for (const token of tokens(text)) {
      if (isField(token.name)) {
        if (!token.hasFallback) needed.add(token.name);
      } else if (token.name !== 'unsubscribe' || field === 'subject') {
        // The link is for the body and the footer; a subject line cannot hold one.
        problems.push({ row: -1, field, code: 'unknown-field' });
      }
    }
  }
  rows.forEach((row, index) => {
    if (!Email.safeParse(normaliseAddress(row.email)).success) {
      problems.push({ row: index, field: 'email', code: 'bad-email' });
    }
    for (const field of needed) {
      if (field !== 'email' && row[field].trim() === '') {
        problems.push({ row: index, field, code: 'empty-field' });
      }
    }
  });
  return problems;
}

/** What one recipient's email is: the subject on one line, the text, the footer under a rule. */
export function renderCampaign(
  request: Pick<SendCampaignRequest, 'subject' | 'body' | 'footer'>,
  row: BatchRow,
  unsubscribe?: string,
): { subject: string; text: string } {
  return {
    subject: oneLine(mergeCampaign(request.subject, row)),
    text: `${mergeCampaign(request.body.trim(), row, unsubscribe)}\n\n-- \n${mergeCampaign(request.footer.trim(), row, unsubscribe)}\n`,
  };
}
