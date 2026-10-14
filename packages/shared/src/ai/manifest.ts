import { z } from 'zod';
import qwen3Text from './models/qwen3-4b-instruct-2507-q4_k_m.json';
import qwen25Vl from './models/qwen2.5-vl-3b-instruct-q4_k_m.json';
import { CAPABILITIES, type Capability } from './capability.js';

/**
 * The model manifest: what each model is, which files it is made of, where they came from and what
 * each must hash to (ADR 0023 section 3 generalised by ADR 0024; ADR 0021: JSON, provenance as
 * fields, schema-validated on load).
 *
 * `licence:check` reads npm packages only, so a model file's licence has no other home. A model is
 * one or more files: weights, optionally a projector (vision) and optionally a runtime binary. A
 * file is published whole or in parts (a GitHub release asset may not exceed 2 GiB; the text model
 * is 2.33), and is joined and hashed on this computer.
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

export const FILE_ROLES = ['weights', 'projector', 'runtime'] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export const ModelFile = z
  .object({
    /** Other names the same file goes by (the upstream name), looked for beside `name`. */
    aliases: z.array(FileName).optional(),
    bytes: z.number().int().positive(),
    /** The name the file has once whole. */
    name: FileName,
    /** Empty: the file is not published by Loppa (evaluation only) or arrives in one piece named `name`. */
    parts: z.array(ModelPart),
    role: z.enum(FILE_ROLES),
    /** Optional only for an evaluation-only model, where it is recorded and labelled unverified. */
    sha256: Sha256.optional(),
  })
  .strict();
export type ModelFile = z.infer<typeof ModelFile>;

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
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().url(),
    sourceRevision: z.string().min(1),
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

export const MODEL_REGISTRY: readonly ModelManifest[] = parseRegistry([qwen3Text, qwen25Vl]);

/** The text model the summary centre uses. */
export const TEXT_MODEL: ModelManifest = MODEL_REGISTRY.find(
  (m) => m.id === 'qwen3-4b-instruct-2507-q4_k_m',
)!;

export function findModel(id: string): ModelManifest | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function modelsFor(capability: Capability): ModelManifest[] {
  return MODEL_REGISTRY.filter((m) => m.capabilities.includes(capability));
}

/** What a model costs in disk and traffic: all its files. */
export function totalBytes(manifest: ModelManifest): number {
  return manifest.files.reduce((total, file) => total + file.bytes, 0);
}

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
    unpublishedReason(manifest) === null
  );
}

/** Every name a file is looked for under. */
export function fileNames(file: ModelFile): string[] {
  return [file.name, ...(file.aliases ?? [])];
}
