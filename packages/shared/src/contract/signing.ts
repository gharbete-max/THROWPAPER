import { z } from 'zod';
import { DocumentHash, Environment, EnvelopeStatus, Party, PartyStatus } from '@tp/signing';
import { IdempotencyKey, OrganisationId } from './common.js';

/**
 * CONTRACT §5 — the Sign product (`docs/adr/0009-where-signing-lives.md`).
 *
 * The shapes come from `@tp/signing`, so the contract and the product cannot disagree about what a
 * party or a document hash is. Every endpoint here is **deferred** until P1c implements it; the
 * schemas exist now so `pnpm contract:check` holds all three products to the same surface from the
 * day the third one exists.
 */

/** §5.1 — a caller (Forms, or a person using Sign alone) asks for a document to be signed. */
export const CreateEnvelopeRequest = z.object({
  organisationId: OrganisationId,
  documentName: z.string().trim().min(1).max(200),
  /** The PDF, fetched once by Sign from a short-lived signed URL the caller issues. */
  documentUrl: z.string().url(),
  /** What the caller hashed. Sign hashes what it fetched and refuses a mismatch. */
  documentSha256: DocumentHash,
  parties: z.array(Party).min(1).max(50),
  routing: z.enum(['sequential', 'parallel']),
  expiresAt: z.string().datetime(),
  /** The human-authored declaration each signer approves (ADR 0012). A key, never the text. */
  declarationKey: z.string().min(1).max(128),
  /** Test mode is the default for anything that has not said otherwise. */
  environment: Environment.default('test'),
  /** Where Sign posts §5.4 events. The caller verifies them with its service token. */
  hookUrl: z.string().url().optional(),
  idempotencyKey: IdempotencyKey,
});

export const CreateEnvelopeResponse = z.object({
  envelopeId: z.string().min(1),
  status: EnvelopeStatus,
  /** Per party, by party id: the link that party signs at. Empty until the envelope is sent. */
  signUrls: z.record(z.string().url()),
});

/** §5.2 — where an envelope stands. */
export const EnvelopeStatusResponse = z.object({
  envelopeId: z.string().min(1),
  status: EnvelopeStatus,
  environment: Environment,
  documentSha256: DocumentHash,
  parties: z.array(Party.extend({ status: PartyStatus })),
});

/** §5.3 — the sealed PDF, once complete: a short-lived link, never the bytes inline. */
export const SealedDocumentResponse = z.object({
  envelopeId: z.string().min(1),
  url: z.string().url(),
  /** SHA-256 of the *sealed* file, which differs from the document's: the seal is part of it. */
  sealedSha256: DocumentHash,
  expiresAt: z.string().datetime(),
});

/** §5.4 — Sign → caller webhook, one per event on the envelope's audit trail. */
export const SigningHookEvent = z.object({
  envelopeId: z.string().min(1),
  partyId: z.string().optional(),
  event: z.enum(['sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled', 'completed']),
  at: z.string().datetime(),
});

export type CreateEnvelopeRequest = z.infer<typeof CreateEnvelopeRequest>;
export type CreateEnvelopeResponse = z.infer<typeof CreateEnvelopeResponse>;
export type EnvelopeStatusResponse = z.infer<typeof EnvelopeStatusResponse>;
export type SealedDocumentResponse = z.infer<typeof SealedDocumentResponse>;
export type SigningHookEvent = z.infer<typeof SigningHookEvent>;
