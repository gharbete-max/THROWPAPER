import { z } from 'zod';

/**
 * What a signature is, as data — the Sign product's shared vocabulary.
 *
 * `docs/adr/0009-where-signing-lives.md` makes signing a third product (`apps/sign`,
 * `apps/api-sign`) behind `docs/CONTRACT.md` §5. This package is the part every side agrees on:
 * pure, no I/O, no secrets, importable by the browser and by any backend. Adapters that hold
 * credentials live in `apps/api-sign`, never here.
 *
 * ## The one rule this file exists to keep
 *
 * **A signature never claims a higher level than it achieves.** The level is derived from the
 * method, capped by {@link maxLevelFor}, and an evidence record that claims more is refused by
 * {@link Evidence}'s refinement — not warned about. What the UI *calls* each level is counsel's
 * wording (ADR 0012); this file only guarantees the data cannot lie.
 */

/** eIDAS levels. `qualified` needs a QTSP and a QSCD, and nothing here can produce one yet. */
export const SIGNATURE_LEVELS = ['simple', 'advanced', 'qualified'] as const;
export const SignatureLevel = z.enum(SIGNATURE_LEVELS);
export type SignatureLevel = z.infer<typeof SignatureLevel>;

/**
 * How a signature was obtained. Never inferred, never defaulted — the same rule as
 * `SigningKind` in the seam this package grew out of.
 *
 * - `drawn` / `typed` — a mark made in the page. Simple.
 * - `eid:<scheme>` — a national eID asserted identity over the document hash, through a broker
 *   (ADR 0010). At most advanced; whether a given broker's output *is* advanced is a contract and
 *   counsel question, so the cap is a ceiling, not a claim.
 * - `console` — the development provider. Simple, and always test mode.
 */
export const SigningMethod = z.union([
  z.enum(['drawn', 'typed', 'console']),
  z.string().regex(/^eid:[a-z][a-z0-9-]{1,30}$/),
]);
export type SigningMethod = z.infer<typeof SigningMethod>;

/** The highest level a method can honestly carry. No method reaches `qualified` today. */
export function maxLevelFor(method: SigningMethod): SignatureLevel {
  return method.startsWith('eid:') ? 'advanced' : 'simple';
}

const LEVEL_RANK: Record<SignatureLevel, number> = { simple: 0, advanced: 1, qualified: 2 };

/** SHA-256 of the exact bytes presented, lower-case hex. */
export const DocumentHash = z.string().regex(/^[0-9a-f]{64}$/);

/** `test` is the repo's test-mode rule applied to signing: never a production-looking result. */
export const Environment = z.enum(['test', 'production']);
export type Environment = z.infer<typeof Environment>;

export const Party = z.object({
  /** Stable within one envelope, so an event can say which party it refers to. */
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  email: z.string().email().optional(),
  /** BCP-47. The signing page opens in the party's language, not the sender's. */
  locale: z.string().min(2).max(35),
  /** Position in a sequential envelope, from 1. Ignored when routing is parallel. */
  order: z.number().int().min(1).max(50),
});
export type Party = z.infer<typeof Party>;

/**
 * What the signer saw and agreed to, as evidence.
 *
 * `declaration` is the exact human-authored text shown (ADR 0012: never generated, versioned),
 * stored byte for byte, because "what did they see" is the first question in a dispute.
 */
export const Evidence = z
  .object({
    method: SigningMethod,
    level: SignatureLevel,
    environment: Environment,
    signedAt: z.string().datetime(),
    documentSha256: DocumentHash,
    declaration: z.object({
      key: z.string().min(1),
      version: z.number().int().min(1),
      text: z.string().min(1),
    }),
    /** What the scheme said, as it said it. Loose on purpose — see the seam's own comment. */
    details: z.record(z.string()).default({}),
  })
  .refine((evidence) => LEVEL_RANK[evidence.level] <= LEVEL_RANK[maxLevelFor(evidence.method)], {
    message: 'The level claims more than the method achieves',
    path: ['level'],
  })
  .refine((evidence) => evidence.method !== 'console' || evidence.environment === 'test', {
    message: 'The console provider only ever signs in test mode',
    path: ['environment'],
  });
export type Evidence = z.infer<typeof Evidence>;

export const PARTY_STATUSES = ['waiting', 'invited', 'viewed', 'signed', 'declined'] as const;
export const PartyStatus = z.enum(PARTY_STATUSES);
export type PartyStatus = z.infer<typeof PartyStatus>;

export const ENVELOPE_STATUSES = [
  'draft',
  'sent',
  'completed',
  'declined',
  'expired',
  'cancelled',
] as const;
export const EnvelopeStatus = z.enum(ENVELOPE_STATUSES);
export type EnvelopeStatus = z.infer<typeof EnvelopeStatus>;

/** The statuses nothing moves out of. A signed document is immutable; a change is a new envelope. */
export const FINAL_STATUSES: readonly EnvelopeStatus[] = [
  'completed',
  'declined',
  'expired',
  'cancelled',
];

export const Envelope = z.object({
  id: z.string().min(1).max(64),
  documentName: z.string().trim().min(1).max(200),
  documentSha256: DocumentHash,
  routing: z.enum(['sequential', 'parallel']),
  parties: z.array(Party).min(1).max(50),
  environment: Environment,
  expiresAt: z.string().datetime(),
  status: EnvelopeStatus,
  partyStatus: z.record(PartyStatus),
  evidence: z.record(Evidence),
});
export type Envelope = z.infer<typeof Envelope>;

/** A new envelope, drafted: every party waiting, nothing signed. */
export function draftEnvelope(
  input: Omit<Envelope, 'status' | 'partyStatus' | 'evidence'>,
): Envelope {
  const ids = input.parties.map((party) => party.id);
  if (new Set(ids).size !== ids.length) throw new Error('Two parties share an id');
  return Envelope.parse({
    ...input,
    status: 'draft',
    partyStatus: Object.fromEntries(ids.map((id) => [id, 'waiting'])),
    evidence: {},
  });
}
