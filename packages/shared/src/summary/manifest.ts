import { z } from 'zod';
import weights from './weights/qwen3-4b-instruct-2507-q4_k_m.json';

/**
 * The weights manifest: what the one model file is, where it came from, and what it must hash to
 * (ADR 0023 section 3, ADR 0021: JSON, provenance as fields, schema-validated on load).
 *
 * `licence:check` reads npm packages only, so a model file's licence has no other home. A test
 * holds this file's values; the desktop app verifies a file against it before every first use.
 *
 * A part's `url` is either an `https` address or the marker {@link UNPUBLISHED} followed by why.
 * Until the release is cut the marker stays, and the download is off with that reason. It is a
 * marker and not an empty string so that nothing can mistake "not yet" for a real address.
 */
export const UNPUBLISHED = 'unpublished:';

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a lower-case SHA-256');
const Address = z
  .string()
  .refine((value) => value.startsWith(UNPUBLISHED) || /^https:\/\/\S+$/.test(value), {
    message: `an https address, or "${UNPUBLISHED}" and the reason`,
  });

export const WeightsPart = z
  .object({
    bytes: z.number().int().positive(),
    name: z.string().regex(/^[A-Za-z0-9._-]+$/, 'a plain file name'),
    sha256: Sha256,
    url: Address,
  })
  .strict();

export const WeightsManifest = z
  .object({
    bytes: z.number().int().positive(),
    id: z.string().regex(/^[a-z0-9._-]+$/),
    /** An SPDX identifier, checked against `licence:check`'s allowlist by `scripts/licence-check.test.ts`. */
    licence: z.string().min(1),
    licenceUrl: z.string().url(),
    parts: z.array(WeightsPart).min(1),
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sha256: Sha256,
    source: z.string().url(),
    sourceRevision: z.string().min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sum = manifest.parts.reduce((total, part) => total + part.bytes, 0);
    if (sum !== manifest.bytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parts'],
        message: `the parts add up to ${sum} bytes, the file is ${manifest.bytes}`,
      });
    }
    if (new Set(manifest.parts.map((part) => part.name)).size !== manifest.parts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parts'],
        message: 'two parts have the same name',
      });
    }
  });
export type WeightsManifest = z.infer<typeof WeightsManifest>;

/** The model Loppa carries. A new model is a new manifest, a new ADR note and a new spike. */
export const MODEL_MANIFEST: WeightsManifest = WeightsManifest.parse(weights);

/** Why the download is off, or null when every part has an address. */
export function unpublishedReason(manifest: WeightsManifest): string | null {
  const part = manifest.parts.find((p) => p.url.startsWith(UNPUBLISHED));
  return part ? part.url.slice(UNPUBLISHED.length).trim() : null;
}

/** The file name the joined model is stored under. */
export function modelFileName(manifest: WeightsManifest): string {
  return `${manifest.id}.gguf`;
}
