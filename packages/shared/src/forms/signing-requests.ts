import { z } from 'zod';
import { DeclarationKey, DeclarationTexts, DeclarationView } from '../contract/signing.js';

/**
 * Forms' own API for sending a document to Sign (P1c-3). Not the contract: this is how the Forms
 * app asks api-forms, which then speaks CONTRACT §5 to Sign on the organisation's behalf.
 */
export const SigningPartyInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional(),
  /** BCP-47. The signer's page opens in this language. */
  locale: z.string().min(2).max(35),
});
export type SigningPartyInput = z.infer<typeof SigningPartyInput>;

const Common = {
  parties: z.array(SigningPartyInput).min(1).max(20),
  routing: z.enum(['sequential', 'parallel']).default('sequential'),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  /** The human-authored declaration at Sign (ADR 0012), by key. `demo` is the seed's placeholder. */
  declarationKey: z.string().trim().min(1).max(128),
  /** Test mode unless somebody says otherwise (rule 7). */
  environment: z.enum(['test', 'production']).default('test'),
};

/** Send a PDF somebody uploaded, or a submission written onto the paper its form was made from. */
export const CreateSigningRequest = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('upload'),
    documentName: z.string().trim().min(1).max(200),
    /** The PDF, base64. At most 10 MB decoded. */
    pdfBase64: z.string().min(1).max(14_000_000),
    ...Common,
  }),
  z.object({
    source: z.literal('paper'),
    submissionId: z.string().uuid(),
    ...Common,
  }),
  /**
   * Paper scanned with a camera (phone or PC), already straightened in the browser: one image per
   * page, in order. The server makes them into a PDF — one page per image, A4 in the image's own
   * orientation — so what Sign seals is a PDF like any other.
   */
  z.object({
    source: z.literal('scan'),
    documentName: z.string().trim().min(1).max(200),
    pages: z
      .array(
        z.object({
          contentType: z.enum(['image/jpeg', 'image/png']),
          base64: z.string().min(1).max(8_000_000),
        }),
      )
      .min(1)
      .max(20),
    ...Common,
  }),
]);
export type CreateSigningRequest = z.input<typeof CreateSigningRequest>;

export const SigningRequestView = z.object({
  id: z.string().uuid(),
  envelopeId: z.string(),
  documentName: z.string(),
  source: z.enum(['upload', 'paper', 'scan']),
  submissionId: z.string().uuid().nullable(),
  environment: z.enum(['test', 'production']),
  status: z.string(),
  parties: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().optional(),
      locale: z.string(),
      order: z.number().int(),
      status: z.string(),
      signUrl: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SigningRequestView = z.infer<typeof SigningRequestView>;

export const SigningRequestList = z.object({
  /** False when this deployment has no Sign to talk to: the screen says so instead of failing. */
  enabled: z.boolean(),
  requests: z.array(SigningRequestView),
});
export type SigningRequestList = z.infer<typeof SigningRequestList>;

/**
 * The declarations a signer can be asked to approve (CONTRACT §5.5), as Forms shows them. The words
 * are written by a person in the organisation — Loppa never writes them (CLAUDE.md rule 8).
 */
export const SigningDeclarationList = z.object({
  enabled: z.boolean(),
  declarations: z.array(DeclarationView),
});
export type SigningDeclarationList = z.infer<typeof SigningDeclarationList>;

export const WriteSigningDeclaration = z.object({ key: DeclarationKey, texts: DeclarationTexts });
export type WriteSigningDeclaration = z.infer<typeof WriteSigningDeclaration>;
