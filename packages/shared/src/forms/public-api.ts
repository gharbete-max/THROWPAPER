import { z } from 'zod';
import { UploadKey } from './uploads.js';
import { BrandKit } from '../brand/index.js';
import { Locale } from '../api/common.js';
import { FormDefinition } from './definition.js';

/** Shapes for the public, unauthenticated form endpoints. */

const IsoDateTime = z.string().datetime({ offset: true });

export const PublicFormResponse = z.object({
  slug: z.string(),
  /** The published definition, never the draft. */
  definition: FormDefinition,
  formVersion: z.number().int().positive(),
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

const AnswerValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

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
});

export const SubmitRejected = z.object({
  status: z.literal('rejected'),
  reason: z.enum(['invalid', 'duplicate', 'full', 'closed']),
  issues: z.array(ValidationIssueResponse).default([]),
});

export const SaveDraftRequest = z.object({
  locale: Locale,
  values: z.record(AnswerValue),
  resumeToken: z.string().min(16).max(512).optional(),
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
