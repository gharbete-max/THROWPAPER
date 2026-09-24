import { z } from 'zod';
import { UploadKey } from './uploads.js';
import { BrandKit } from '../brand/index.js';
import { Locale, LocalisedText } from '../api/common.js';
import { FormDefinition, MAX_GROUP_ENTRIES } from './definition.js';

/** Shapes for the public, unauthenticated form endpoints. */

const IsoDateTime = z.string().datetime({ offset: true });

export const PublicFormResponse = z.object({
  slug: z.string(),
  /** The published definition, never the draft. */
  definition: FormDefinition,
  formVersion: z.number().int().positive(),
  /**
   * What the form is called, in every language it was written in.
   *
   * The page had no heading at all: a respondent who followed a link saw the organisation's name
   * and then a first question, with nothing confirming what they had opened. It was not an
   * oversight in the page — the title was never sent, so the page could not have shown it.
   *
   * Localised, like everything else a respondent reads, so a form offered in two languages is
   * titled in whichever one they are reading it in.
   */
  title: LocalisedText,
  organisationName: z.string(),
  /**
   * The organisation's brand kit, so the page an anonymous visitor lands on is branded without a
   * second request and without a flash of the default palette. Sent in full rather than as an id:
   * there is no session here to fetch it with.
   */
  brand: BrandKit,
  supportedLocales: z.array(Locale),
  defaultLocale: Locale,
  /** Whether the form is currently accepting answers, and why not when it is not. */
  open: z.boolean(),
  closedReason: z.enum(['not-open-yet', 'closed', 'full', 'unpublished']).nullable(),
  closesAt: IsoDateTime.nullable(),
});

export const ValidationIssueResponse = z.object({
  key: z.string(),
  code: z.string(),
  params: z.record(z.union([z.string(), z.number()])).optional(),
});

const ScalarAnswer = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

/**
 * One entry of a repeating group, keyed by the child's own key.
 *
 * Deliberately not recursive: a group may not contain a group, so an entry holds single values and
 * nothing else. Making the schema mirror that is what stops a client posting arbitrarily nested
 * JSON into a form's answers, which is a parser running on a stranger's bytes with no bottom.
 *
 * `MAX_GROUP_ENTRIES` bounds the list here as well as in the validator. The validator's version
 * produces a message a respondent can act on; this one exists so a request with ten thousand
 * entries is refused before anything walks it.
 */
const GroupAnswer = z.array(z.record(ScalarAnswer)).max(MAX_GROUP_ENTRIES);

const AnswerValue = z.union([ScalarAnswer, GroupAnswer]);

export const SubmitRequest = z.object({
  locale: Locale,
  values: z.record(AnswerValue),
  /** Continues an existing draft rather than starting a new submission. */
  resumeToken: z.string().min(16).max(512).optional(),
  /**
   * Honeypot. A real person never sees this field, so anything in it is a bot.
   * Named innocuously on purpose — `honeypot` would be trivially skipped.
   */
  website: z.string().max(200).optional(),
});

export const SubmitResponse = z.object({
  status: z.literal('received'),
  reference: z.string(),
  confirmationMessage: z.string(),
  /**
   * What happens next, as the server knows it, so the confirmation screen states only facts.
   *
   * The screen said "Thank you" and a reference, and people were left unsure whether anything
   * was coming. A mail is queued to the address the form collected — `null` when it collected
   * none — and the admission card rides with that mail only when the form is bound to an event.
   */
  confirmationTo: z.string().nullable(),
  admissionCard: z.boolean(),
  /**
   * The finished document — the PDF of what was just sent — and how to fetch it.
   *
   * `token` is the respondent's only credential for it: bound to this submission, valid for a day,
   * sent back to `POST /public/forms/:slug/document` in the body (never in a URL, where it would
   * sit in history and logs). `filename` is what the file will be called, so the screen can name
   * it before it is downloaded. `null` when there is no document to offer.
   */
  document: z
    .object({
      token: z.string().min(1).max(200),
      filename: z.string(),
      /**
       * The mail program this computer can open a draft in, with the PDF attached — "classic
       * Outlook", "Apple Mail" — on the desktop edition. `null` everywhere else, where the page
       * offers the download, the share sheet and `mailto:` instead.
       */
      draftProgram: z.string().nullable(),
    })
    .nullable(),
  /**
   * The optional e-ID step, when the form offers one (`settings.identity: "optional"`).
   *
   * `available: false` means no identity provider is configured (CONTRACT §5.6 offered none): the
   * page says so and the form is simply finished. `test: true` means the only provider is the
   * development one, and anything it "confirms" is labelled a test everywhere it appears.
   * `null` when the form does not offer the step at all.
   */
  identity: z.object({ available: z.boolean(), test: z.boolean() }).nullable(),
});

export const StartIdentityCheck = z.object({ token: z.string().min(1).max(200) });

export const IdentityCheckStarted = z.object({
  /** Sign's reference (≤ 128) and a 43-character binding: never cut off by this limit. */
  reference: z.string().min(1).max(200),
  status: z.enum(['pending', 'complete', 'failed', 'cancelled']),
  /** Same device: open this. Absent when the provider gives none. */
  launchUrl: z.string().url().optional(),
});

export const IdentityCheckRequest = z.object({
  token: z.string().min(1).max(200),
  reference: z.string().min(1).max(200),
});

/** Where the person's confirmation stands. `confirmed` only once the provider has answered. */
export const IdentityCheckResponse = z.object({
  status: z.enum(['pending', 'complete', 'failed', 'cancelled']),
  confirmed: z
    .object({
      method: z.string(),
      /** The name the scheme asserted. */
      name: z.string().nullable(),
      /** A development provider's answer: never a real identity check. */
      test: z.boolean(),
    })
    .nullable(),
});
export type IdentityCheckResponse = z.infer<typeof IdentityCheckResponse>;

export const FinishedDocumentRequest = z.object({
  token: z.string().min(1).max(200),
});
export type FinishedDocumentRequest = z.infer<typeof FinishedDocumentRequest>;

/**
 * Opens a draft in this computer's mail program with the finished document attached. The words
 * are the person's own, from the page; no recipient is set and nothing is sent.
 */
export const EmailDraftRequest = z.object({
  token: z.string().min(1).max(200),
  /** One line: a subject with a line break in it would be two headers. */
  subject: z
    .string()
    .max(300)
    .regex(/^[^\r\n]*$/),
  text: z.string().max(4000),
});
export type EmailDraftRequest = z.infer<typeof EmailDraftRequest>;

export const SubmitRejected = z.object({
  status: z.literal('rejected'),
  reason: z.enum(['invalid', 'duplicate', 'full', 'closed']),
  issues: z.array(ValidationIssueResponse).default([]),
});

export const SaveDraftRequest = z.object({
  locale: Locale,
  values: z.record(AnswerValue),
  resumeToken: z.string().min(16).max(512).optional(),
  /**
   * The same honeypot the submit route has, for the same reason.
   *
   * Saving a draft emails a link to whatever address the answers contain. That makes this route an
   * anonymous "send mail from the customer's verified domain to an address I choose" endpoint —
   * the more attractive half of the pair, because unlike submitting it leaves no row anybody
   * reviews. It shipped without the honeypot its sibling has.
   */
  website: z.string().max(200).optional(),
});

export const SaveDraftResponse = z.object({
  /** Shown on screen with a copy button, and also sent through the mail transport. */
  resumeToken: z.string(),
  expiresAt: IsoDateTime,
});

export const ResumeResponse = z.object({
  locale: Locale,
  values: z.record(AnswerValue),
  formVersion: z.number().int().positive(),
});

export type PublicFormResponse = z.infer<typeof PublicFormResponse>;
export type SubmitRequest = z.infer<typeof SubmitRequest>;
export type SubmitResponse = z.infer<typeof SubmitResponse>;
export type SubmitRejected = z.infer<typeof SubmitRejected>;
export type SaveDraftResponse = z.infer<typeof SaveDraftResponse>;
export type ResumeResponse = z.infer<typeof ResumeResponse>;

/** What the browser gets back after attaching a file, so it can show the name it will submit. */
export const UploadAttachmentResponse = z.object({
  key: UploadKey,
  filename: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type UploadAttachmentResponse = z.infer<typeof UploadAttachmentResponse>;
