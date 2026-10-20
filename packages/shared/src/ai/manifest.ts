import { z } from 'zod';
import qwen25Vl7b from './models/qwen2.5-vl-7b-instruct-q4_k_m.json';
import qwen3Vl4b from './models/qwen3-vl-4b-instruct-q4_k_m.json';
import qwen3Vl2b from './models/qwen3-vl-2b-instruct-q4_k_m.json';
import smolvlm22b from './models/smolvlm2-2.2b-instruct-q4_k_m.json';
import smolvlm500m from './models/smolvlm2-500m-video-instruct-q8_0.json';
import smolvlm256m from './models/smolvlm2-256m-video-instruct-q4_k_m.json';
import { CAPABILITIES, type Capability } from './capability.js';

/**
 * The model manifest: what each model is, which files it is made of, where they came from and what
 * each must hash to (ADR 0023 section 3 generalised by ADR 0024; ADR 0021: JSON, provenance as
 * fields, schema-validated on load).
 *
 * `licence:check` reads npm packages only, so a model file's licence has no other home. A model is
 * one or more files: weights, optionally a projector (vision) and optionally a runtime binary. A
 * file is published whole or in parts (a GitHub release asset may not exceed 2 GiB; the text model
 * is 4.68 GB in three), and is joined and hashed on this computer.
 *
 * `evaluationOnly` marks a model under a licence that does not allow shipping it (a research
 * licence): it is accepted where the owner put it, labelled, never offered for download and never
 * in a release. `distributable` and `evaluationOnly` cannot both be true.
 *
 * A part's `url` is either an `https` address or the marker {@link UNPUBLISHED} followed by why.
 * It is a marker and not an empty string so that nothing can mistake "not yet" for a real address.
 */
export const UNPUBLISHED = 'unpublished:';

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a lower-case SHA-256');
const FileName = z.string().regex(/^[A-Za-z0-9._-]+$/, 'a plain file name');
const Address = z
  .string()
  .refine((value) => value.startsWith(UNPUBLISHED) || /^https:\/\/\S+$/.test(value), {
    message: `an https address, or "${UNPUBLISHED}" and the reason`,
  });

export const ModelPart = z
  .object({
    bytes: z.number().int().positive(),
    name: FileName,
    sha256: Sha256,
    url: Address,
  })
  .strict();
export type ModelPart = z.infer<typeof ModelPart>;

/** `projector-lite` is the smaller projector (Q8_0): an optional alternative to `projector`. */
export const FILE_ROLES = ['weights', 'projector', 'projector-lite', 'runtime'] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export const ModelFile = z
  .object({
    /** Other names the same file goes by (the upstream name), looked for beside `name`. */
    aliases: z.array(FileName).optional(),
    bytes: z.number().int().positive(),
    /** The name the file has once whole. */
    name: FileName,
    /** Not needed for the model to be installed or downloaded; used when present. */
    optional: z.boolean().optional(),
    /** Empty: the file is not published by Loppa (evaluation only) or arrives in one piece named `name`. */
    parts: z.array(ModelPart),
    role: z.enum(FILE_ROLES),
    /** Optional only for an evaluation-only model, where it is recorded and labelled unverified. */
    sha256: Sha256.optional(),
  })
  .strict();
export type ModelFile = z.infer<typeof ModelFile>;

/** Best first. A tier is a promise about hardware and about quality, in that order of honesty. */
export const TIERS = ['full', 'balanced', 'light', 'very-light'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Whether the model has been run through Loppa's engine: `working` (with the measurement),
 * `untested` (pinned and verified on the Hub, never run here) or `not-working-yet` (it was run and
 * failed: the evidence says how, and the list says so rather than hiding it).
 */
export const Support = z
  .object({
    evidence: z.string().min(1),
    state: z.enum(['working', 'untested', 'not-working-yet']),
  })
  .strict();
export type Support = z.infer<typeof Support>;

export const ModelManifest = z
  .object({
    capabilities: z.array(z.enum(CAPABILITIES)).min(1),
    /** True when the files may go in a release. Never true together with `evaluationOnly`. */
    distributable: z.boolean(),
    evaluationOnly: z.boolean(),
    files: z.array(ModelFile).min(1),
    id: z.string().regex(/^[a-z0-9._-]+$/),
    /** The folder under `local-models/` and `LOPPA_AI_DIR` the files are looked for in. */
    kind: z.string().regex(/^[a-z0-9-]+$/),
    /** An SPDX identifier, checked against `licence:check`'s allowlist for a distributable model. */
    licence: z.string().min(1),
    licenceUrl: z.string().url(),
    /** A proper noun, not a sentence: it is the one string of a model that is not translated. */
    name: z.string().min(1),
    /** Free memory needed to load it: checked before loading. */
    requiredMemoryBytes: z.number().int().positive(),
    /** False: `requiredMemoryBytes` is an estimate, not a measurement. The list says so. */
    requiredMemoryVerified: z.boolean(),
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().url(),
    sourceRevision: z.string().min(1),
    support: Support,
    tier: z.enum(TIERS),
  })
  .strict()
  .superRefine((manifest, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (manifest.distributable && manifest.evaluationOnly) {
      issue(['evaluationOnly'], 'an evaluation-only model cannot be distributable');
    }
    if (!manifest.files.some((file) => file.role === 'weights')) {
      issue(['files'], 'a model has weights');
    }
    const names = manifest.files.flatMap((file) => [file.name, ...(file.aliases ?? [])]);
    if (new Set(names).size !== names.length) issue(['files'], 'two files have the same name');

    for (const [index, file] of manifest.files.entries()) {
      const at = ['files', index];
      if (manifest.evaluationOnly) {
        if (file.parts.length > 0) issue([...at, 'parts'], 'an evaluation-only file has no parts');
        continue;
      }
      if (!file.sha256) issue([...at, 'sha256'], 'a file that is released has a hash');
      if (file.parts.length === 0) issue([...at, 'parts'], 'a file that is released has parts');
      const sum = file.parts.reduce((total, part) => total + part.bytes, 0);
      if (file.parts.length > 0 && sum !== file.bytes) {
        issue([...at, 'parts'], `the parts add up to ${sum} bytes, the file is ${file.bytes}`);
      }
      // One part named like the file is a download with nothing to join.
      if (file.parts.length === 1 && file.parts[0]!.sha256 !== file.sha256) {
        issue([...at, 'parts'], 'a single part is the whole file and has its hash');
      }
      if (new Set(file.parts.map((part) => part.name)).size !== file.parts.length) {
        issue([...at, 'parts'], 'two parts have the same name');
      }
    }
  });
export type ModelManifest = z.infer<typeof ModelManifest>;

/** Every model Loppa knows. A new model is a new manifest, an ADR note and a spike. */
export function parseRegistry(list: readonly unknown[]): readonly ModelManifest[] {
  const parsed = list.map((entry) => ModelManifest.parse(entry));
  if (new Set(parsed.map((m) => m.id)).size !== parsed.length) {
    throw new Error('two models have the same id');
  }
  return parsed;
}

export const MODEL_REGISTRY: readonly ModelManifest[] = parseRegistry([
  qwen25Vl7b,
  qwen3Vl4b,
  qwen3Vl2b,
  smolvlm22b,
  smolvlm500m,
  smolvlm256m,
]);

/**
 * The one model (ADR 0025): it reads pictures of pages and writes summaries, translations and
 * replies. Kept under the name the summary centre and the reply helper already use.
 */
export const TEXT_MODEL: ModelManifest = MODEL_REGISTRY.find(
  (m) => m.id === 'qwen2.5-vl-7b-instruct-q4_k_m',
)!;

export function findModel(id: string): ModelManifest | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function modelsFor(capability: Capability): ModelManifest[] {
  return MODEL_REGISTRY.filter((m) => m.capabilities.includes(capability));
}

/** What a model costs in disk and traffic: all its required files. */
export function totalBytes(manifest: ModelManifest): number {
  return manifest.files.reduce((total, file) => total + (file.optional ? 0 : file.bytes), 0);
}

/**
 * Where a model may be fetched from, and where a redirect may lead (ADR 0026: the network only on
 * a confirmed action, to a host the person was told). Hugging Face serves a file from its own name
 * and then from a CDN under `hf.co`; nothing else is followed.
 */
export const DOWNLOAD_HOSTS = ['huggingface.co', 'hf.co'] as const;

export function isAllowedHost(host: string): boolean {
  const name = host.toLowerCase();
  return DOWNLOAD_HOSTS.some((allowed) => name === allowed || name.endsWith(`.${allowed}`));
}

const hostAllowed = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && isAllowedHost(parsed.hostname);
  } catch {
    return false;
  }
};

/** Why the download is off, or null when it can be started. */
export function unpublishedReason(manifest: ModelManifest): string | null {
  for (const file of manifest.files) {
    const part = file.parts.find((p) => p.url.startsWith(UNPUBLISHED));
    if (part) return part.url.slice(UNPUBLISHED.length).trim();
  }
  return null;
}

/** Can Loppa fetch this model: it is released, distributable, and has an address for every part. */
export function isDownloadable(manifest: ModelManifest): boolean {
  return (
    manifest.distributable &&
    !manifest.evaluationOnly &&
    manifest.files.every((file) => file.parts.length > 0) &&
    manifest.files.every((file) =>
      file.parts.every((part) => part.url.startsWith(UNPUBLISHED) || hostAllowed(part.url)),
    ) &&
    unpublishedReason(manifest) === null
  );
}

/** Every name a file is looked for under. */
export function fileNames(file: ModelFile): string[] {
  return [file.name, ...(file.aliases ?? [])];
}
