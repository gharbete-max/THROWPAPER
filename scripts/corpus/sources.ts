import { z } from 'zod';

/**
 * The golden corpus's two manifests, `fixtures/documents/SOURCES.json` and its `scans/SOURCES.json`,
 * as everything that reads them reads them: through Zod, on load (ADR 0021).
 *
 * A document is made for Loppa (no `origin`: written in `documents.ts`, built by `pnpm corpus:build`,
 * CC0 like the manifest) or real (`origin: "real"`: found, not written here). A real one carries its
 * own licence, where it was found, when, and whom to credit, and is never built or rewritten
 * (`docs/plan/IMPORT-PIPELINE.md`, "The golden corpus"). The formats a document has are its
 * `files`' keys.
 */

/**
 * The licences a real document may be kept under in a repository that may be public: SPDX ids, and
 * Wikimedia Commons' public-domain tags where no SPDX id says the same. Each but `permission` has its
 * text in `fixtures/documents/licences/`. `permission` is a customer's written leave to redistribute
 * one blank form, recorded in the entry itself.
 */
export const LICENCES = [
  'CC0-1.0',
  'CC-BY-4.0',
  'OGL-UK-3.0',
  'PD-USGov',
  'PD-US-expired',
  'PD-old-70',
  'permission',
] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const file = z
  .object({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();
const name = z.string().regex(/^[a-z0-9-]+$/);
const summary = z.string().min(21);

const provenance = {
  origin: z.literal('real'),
  licence: z.enum(LICENCES),
  source: z
    .object({ url: z.string().url(), retrieved: date, attribution: z.string().min(1) })
    .strict(),
  permission: z
    .object({ from: z.string().min(1), date, scope: z.string().min(1) })
    .strict()
    .optional(),
};
/** A permission is the licence or it is absent: never one without the other. */
const permitted = (entry: { licence: string; permission?: object }) =>
  (entry.licence === 'permission') === (entry.permission !== undefined);

const described = {
  name,
  language: z.string(),
  summary,
  features: z.array(z.string()).min(1),
};
const madeDocument = z
  .object({
    ...described,
    spec: z.literal('scripts/corpus/documents.ts'),
    files: z.object({ pdf: file, docx: file }).strict(),
  })
  .strict();
const realDocument = z
  .object({
    ...described,
    ...provenance,
    files: z
      .object({ pdf: file, docx: file })
      .partial()
      .strict()
      .refine((files) => Object.keys(files).length > 0, 'a real document has a file'),
  })
  .strict()
  .refine(permitted, 'a permission is the licence, or absent');

export const corpusSources = z
  .object({
    $comment: z.string(),
    licence: z.literal('CC0-1.0'),
    tool: z.string().regex(/^LibreOffice \d+\.\d+/),
    documents: z.array(z.union([madeDocument, realDocument])),
  })
  .strict();
export type CorpusDocument = z.infer<typeof corpusSources>['documents'][number];

const files = z.record(file);
/** A corpus document's page, printed and scanned by `pnpm corpus:scan` (S14). */
const scannedHere = z
  .object({
    name,
    from: z.string().regex(/\.pdf$/),
    locale: z.string(),
    dpi: z.number().int().positive(),
    skew: z.number(),
    files,
  })
  .strict();
/** A picture of real paper, kept exactly as found: `image` is the picture, one of its `files`. */
const realPaper = z
  .object({
    name,
    summary,
    image: z.string().regex(/\.(png|jpe?g)$/),
    locale: z.string(),
    ...provenance,
    files,
  })
  .strict()
  .refine(permitted, 'a permission is the licence, or absent')
  .refine(
    (scan) => Object.values(scan.files).some((one) => one.path === scan.image),
    'the picture is one of its files',
  );

export const scanSources = z
  .object({
    licence: z.literal('CC0-1.0'),
    tool: z.string().regex(/^pdfjs-dist@\S+ \+ Tesseract \S+$/),
    scans: z.array(z.union([scannedHere, realPaper])),
  })
  .strict();

/**
 * What `pnpm corpus:build` keeps of the manifest when it builds `names`: every real document, as
 * it is, and, when it builds only some, the made ones it leaves alone. A spec named as a real
 * document is refused before anything is written.
 */
export function keptBy(previous: CorpusDocument[], names: string[], partial: boolean) {
  const clash = previous.find((doc) => 'origin' in doc && names.includes(doc.name));
  if (clash) throw new Error(`${clash.name} is a real document: corpus:build never writes it.`);
  return previous.filter((doc) => 'origin' in doc || (partial && !names.includes(doc.name)));
}
