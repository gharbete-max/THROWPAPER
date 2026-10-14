import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CacheKeyParts,
  MODEL_REGISTRY,
  ModelManifest,
  StructuredDocument,
  TASK_CAPABILITY,
  TEXT_MODEL,
  UNPUBLISHED,
  cacheKey,
  capabilityOf,
  findModel,
  isDownloadable,
  modelsFor,
  parseRegistry,
  totalBytes,
  unpublishedReason,
} from './index.js';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const VISION = findModel('qwen2.5-vl-3b-instruct-q4_k_m')!;

describe('the text model manifest', () => {
  it('holds the values the owner chose and the spike measured', () => {
    expect(TEXT_MODEL).toMatchObject({
      id: 'qwen3-4b-instruct-2507-q4_k_m',
      licence: 'Apache-2.0',
      capabilities: ['text'],
      distributable: true,
      evaluationOnly: false,
      requiredMemoryBytes: 5_000_000_000,
      retrievedAt: '2026-10-13',
    });
    const [file] = TEXT_MODEL.files;
    expect(file).toMatchObject({
      name: 'qwen3-4b-instruct-2507-q4_k_m.gguf',
      bytes: 2497281120,
      sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
    });
    expect(file!.parts.map((p) => p.bytes)).toEqual([1248640560, 1248640560]);
    expect(file!.parts.map((p) => p.sha256)).toEqual([
      '03377c7b7cdc673232fc6fa7455a5d06e9f9abf7f88840e43ac1273a167ff67c',
      '4b589d9775c55bb47df28d73b480e06d7d80a4b0f27d3672f15ef078b14b7a38',
    ]);
    expect(totalBytes(TEXT_MODEL)).toBe(2497281120);
  });

  it('keeps each part under the 2 GiB release-asset limit', () => {
    for (const part of TEXT_MODEL.files[0]!.parts) expect(part.bytes).toBeLessThan(2 * 1024 ** 3);
  });

  it('is released, so the download is on', () => {
    expect(unpublishedReason(TEXT_MODEL)).toBeNull();
    expect(isDownloadable(TEXT_MODEL)).toBe(true);
  });
});

describe('the registry', () => {
  it('has every manifest file in ADR 0021 form: keys sorted at every level, one trailing newline', () => {
    const dir = join(HERE, 'models');
    const names = readdirSync(dir);
    expect(names.length).toBe(MODEL_REGISTRY.length);
    const sorted = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sorted)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b, 'en'))
                .map(([k, v]) => [k, sorted(v)]),
            )
          : value;
    for (const name of names) {
      const text = readFileSync(join(dir, name), 'utf8');
      // Prettier owns the layout (it keeps short arrays on a line); the order of the keys is ours.
      expect(/\}\n$/.test(text), name).toBe(true);
      expect(JSON.stringify(JSON.parse(text)), name).toBe(JSON.stringify(sorted(JSON.parse(text))));
    }
  });

  it('finds models by id and by capability', () => {
    expect(findModel('nope')).toBeUndefined();
    expect(modelsFor('text').map((m) => m.id)).toEqual([TEXT_MODEL.id]);
    expect(modelsFor('vision').map((m) => m.id)).toEqual([VISION.id]);
  });

  it('refuses two models with one id', () => {
    expect(() => parseRegistry([TEXT_MODEL, TEXT_MODEL])).toThrow('same id');
  });

  it('is refused when a manifest is wrong', () => {
    const file = TEXT_MODEL.files[0]!;
    const withFile = (patch: object) => ({ ...TEXT_MODEL, files: [{ ...file, ...patch }] });
    expect(ModelManifest.safeParse(withFile({ bytes: file.bytes + 1 })).success).toBe(false);
    expect(ModelManifest.safeParse(withFile({ sha256: 'ABC' })).success).toBe(false);
    expect(ModelManifest.safeParse(withFile({ sha256: undefined })).success).toBe(false);
    expect(ModelManifest.safeParse(withFile({ parts: [] })).success).toBe(false);
    expect(
      ModelManifest.safeParse(
        withFile({ parts: file.parts.map((p) => ({ ...p, url: 'http://example.com/x' })) }),
      ).success,
    ).toBe(false);
    expect(
      ModelManifest.safeParse(withFile({ parts: [file.parts[0], file.parts[0]] })).success,
    ).toBe(false);
    expect(ModelManifest.safeParse({ ...TEXT_MODEL, files: [] }).success).toBe(false);
    expect(ModelManifest.safeParse({ ...TEXT_MODEL, capabilities: ['audio'] }).success).toBe(false);
  });

  it('marks an unpublished release plainly, and says why the download is off', () => {
    const file = TEXT_MODEL.files[0]!;
    const unpublished = ModelManifest.parse({
      ...TEXT_MODEL,
      files: [
        {
          ...file,
          parts: file.parts.map((p) => ({
            ...p,
            url: `${UNPUBLISHED}the release has not been cut yet`,
          })),
        },
      ],
    });
    expect(unpublishedReason(unpublished)).toBe('the release has not been cut yet');
    expect(isDownloadable(unpublished)).toBe(false);
  });

  it('accepts a model of several files: weights and a projector', () => {
    expect(VISION.files.map((f) => f.role)).toEqual(['weights', 'projector']);
    expect(totalBytes(VISION)).toBe(1929901056 + 844757728);
  });

  it('takes a single part as the whole file, with its hash', () => {
    const one = {
      ...TEXT_MODEL,
      files: [
        {
          bytes: 10,
          name: 'm.gguf',
          parts: [{ bytes: 10, name: 'm.gguf', sha256: 'a'.repeat(64), url: 'https://x.test/m' }],
          role: 'weights',
          sha256: 'a'.repeat(64),
        },
      ],
    };
    expect(ModelManifest.safeParse(one).success).toBe(true);
    one.files[0]!.parts[0]!.sha256 = 'b'.repeat(64);
    expect(ModelManifest.safeParse(one).success).toBe(false);
  });
});

describe('an evaluation-only model', () => {
  it('is Qwen2.5-VL under a research licence: not distributable, never downloadable', () => {
    expect(VISION).toMatchObject({
      evaluationOnly: true,
      distributable: false,
      licence: 'Qwen-Research',
    });
    expect(isDownloadable(VISION)).toBe(false);
    expect(VISION.files.every((f) => f.parts.length === 0)).toBe(true);
  });

  it('cannot also be distributable', () => {
    expect(ModelManifest.safeParse({ ...VISION, distributable: true }).success).toBe(false);
  });

  it('cannot carry a download address', () => {
    const file = { ...VISION.files[0]!, parts: TEXT_MODEL.files[0]!.parts };
    expect(ModelManifest.safeParse({ ...VISION, files: [file] }).success).toBe(false);
  });

  it('may leave a file unhashed, and nothing else may', () => {
    const { sha256: _gone, ...unpinned } = VISION.files[0]!;
    expect(ModelManifest.safeParse({ ...VISION, files: [unpinned] }).success).toBe(true);
    const released = { ...TEXT_MODEL, files: [{ ...TEXT_MODEL.files[0]!, sha256: undefined }] };
    expect(ModelManifest.safeParse(released).success).toBe(false);
  });

  it('is never offered as the licence of a distributable model', () => {
    for (const m of MODEL_REGISTRY) if (m.evaluationOnly) expect(m.distributable).toBe(false);
  });
});

describe('tasks', () => {
  it('each name one capability', () => {
    expect(capabilityOf({ kind: 'summarise' })).toBe('text');
    expect(capabilityOf({ kind: 'translate' })).toBe('text');
    expect(capabilityOf({ kind: 'select' })).toBe('text');
    expect(capabilityOf({ kind: 'read-page' })).toBe('vision');
    for (const kind of [
      'draft-reply',
      'shorten-reply',
      'translate-reply',
      'revise-reply',
    ] as const) {
      expect(capabilityOf({ kind })).toBe('text');
    }
    expect(Object.keys(TASK_CAPABILITY).sort()).toEqual([
      'draft-reply',
      'read-page',
      'revise-reply',
      'select',
      'shorten-reply',
      'summarise',
      'translate',
      'translate-reply',
    ]);
  });
});

describe('the cache key', () => {
  const base = {
    fileSha256: 'a'.repeat(64),
    page: 3,
    pipelineVersion: 1,
    modelId: 'm',
    settings: { pixels: 1_000_000, pass: 'first' },
  };

  it('is the same for the same inputs whatever order the settings are written in', () => {
    expect(cacheKey(base)).toBe(
      cacheKey({ ...base, settings: { pass: 'first', pixels: 1_000_000 } }),
    );
  });

  it('changes when any one input changes', () => {
    const key = cacheKey(base);
    const patches: Array<Partial<CacheKeyParts>> = [
      { fileSha256: 'b'.repeat(64) },
      { page: 4 },
      { pipelineVersion: 2 },
      { modelId: 'n' },
      { settings: { pixels: 2_000_000, pass: 'first' } },
      { settings: { pixels: 1_000_000 } },
    ];
    const others = patches.map((patch) => cacheKey({ ...base, ...patch }));
    expect(new Set([key, ...others]).size).toBe(others.length + 1);
  });

  it('cannot be confused by a separator inside a setting', () => {
    const a = cacheKey({ ...base, settings: { a: 'x|1', b: '2' } });
    const b = cacheKey({ ...base, settings: { a: 'x', b: '1|2' } });
    expect(a).not.toBe(b);
  });

  it('refuses what is not a file hash or a page', () => {
    expect(() => cacheKey({ ...base, fileSha256: 'short' })).toThrow();
    expect(() => cacheKey({ ...base, page: 0 })).toThrow();
    expect(() => cacheKey({ ...base, page: 1.5 })).toThrow();
  });
});

describe('the structured document', () => {
  const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.1 };
  const common = { page: 1, box, language: 'sv-SE', confidence: 0.9 };
  const doc = (pages: unknown[], pageCount = pages.length) => ({
    version: 1,
    fileSha256: 'c'.repeat(64),
    pageCount,
    pages,
  });
  const ok = {
    page: 1,
    status: 'ok',
    reason: null,
    blocks: [
      { type: 'heading', level: 1, text: 'Protokoll', ...common },
      { type: 'paragraph', text: 'Text.', ...common },
      {
        type: 'table',
        rows: 1,
        columns: 2,
        cells: [
          { row: 0, column: 0, text: 'a' },
          { row: 0, column: 1, text: 'b' },
        ],
        ...common,
      },
      { type: 'field', label: 'Namn', value: 'Anna', ...common },
      { type: 'checkbox', label: 'Ja', checked: true, ...common },
      { type: 'figure', caption: null, ...common },
    ],
  };

  it('holds every block kind with its page, box, language and confidence', () => {
    const parsed = StructuredDocument.parse(doc([ok]));
    expect(parsed.pages[0]!.blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'table',
      'field',
      'checkbox',
      'figure',
    ]);
  });

  it('lists a page that failed or is uncertain, with its reason, and refuses one without', () => {
    const failed = { page: 2, status: 'failed', reason: 'unreadable', blocks: [] };
    const uncertain = { ...ok, page: 3, status: 'uncertain', reason: 'text layer disagrees' };
    uncertain.blocks = ok.blocks.map((b) => ({ ...b, page: 3 }));
    expect(StructuredDocument.safeParse(doc([ok, failed, uncertain])).success).toBe(true);
    expect(StructuredDocument.safeParse(doc([{ ...failed, reason: null }])).success).toBe(false);
    expect(StructuredDocument.safeParse(doc([{ ...failed, blocks: ok.blocks }])).success).toBe(
      false,
    );
  });

  it('refuses a block on the wrong page, a gap in the pages, and a box off the page', () => {
    expect(
      StructuredDocument.safeParse(doc([{ ...ok, blocks: [{ ...ok.blocks[0]!, page: 2 }] }]))
        .success,
    ).toBe(false);
    expect(StructuredDocument.safeParse(doc([{ ...ok, page: 2 }], 2)).success).toBe(false);
    const off = {
      ...ok,
      blocks: [{ ...ok.blocks[1]!, box: { x: 0.8, y: 0, width: 0.5, height: 0.1 } }],
    };
    expect(StructuredDocument.safeParse(doc([off])).success).toBe(false);
  });

  it('refuses an unknown block type or a confidence outside 0 to 1', () => {
    const bad = (block: object) =>
      StructuredDocument.safeParse(doc([{ ...ok, blocks: [block] }])).success;
    expect(bad({ type: 'video', ...common })).toBe(false);
    expect(bad({ type: 'paragraph', text: 'x', ...common, confidence: 1.5 })).toBe(false);
  });
});
