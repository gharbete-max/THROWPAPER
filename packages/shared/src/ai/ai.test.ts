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
  LLAMA_SERVER,
  RuntimeManifest,
  runtimeAssetFor,
  isDownloadable,
  modelsFor,
  parseRegistry,
  totalBytes,
  unpublishedReason,
} from './index.js';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
/** A made-up model under a research licence: the registry holds none now, the rule still stands. */
const VISION = ModelManifest.parse({
  capabilities: ['vision'],
  distributable: false,
  evaluationOnly: true,
  files: [
    { bytes: 100, name: 'eval.gguf', parts: [], role: 'weights', sha256: 'a'.repeat(64) },
    { bytes: 50, name: 'eval-proj.gguf', parts: [], role: 'projector', sha256: 'b'.repeat(64) },
  ],
  id: 'eval-model',
  kind: 'eval',
  licence: 'Qwen-Research',
  licenceUrl: 'https://example.test/licence',
  name: 'Evaluation model',
  requiredMemoryBytes: 1,
  requiredMemoryVerified: false,
  retrievedAt: '2026-10-19',
  source: 'https://example.test/',
  sourceRevision: 'x',
  support: { evidence: 'test', state: 'untested' },
  tier: 'light',
});

describe('the model manifest', () => {
  it('holds the owner model as the full tier, with the hashes of the files he placed', () => {
    expect(MODEL_REGISTRY.map((m) => m.tier)).toEqual([
      'full',
      'balanced',
      'light',
      'very-light',
      'very-light',
      'very-light',
    ]);
    expect(TEXT_MODEL).toMatchObject({
      id: 'qwen2.5-vl-7b-instruct-q4_k_m',
      licence: 'Apache-2.0',
      capabilities: ['text', 'vision'],
      distributable: true,
      evaluationOnly: false,
      requiredMemoryBytes: 10_000_000_000,
      retrievedAt: '2026-10-20',
    });
    const [weights, projector] = TEXT_MODEL.files;
    expect(weights).toMatchObject({
      role: 'weights',
      name: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf',
      bytes: 4683072032,
      sha256: '9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392',
    });
    expect(projector).toMatchObject({
      role: 'projector',
      name: 'mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf',
      bytes: 1354162912,
      sha256: 'c24a7f5fcfc68286f0a217023b6738e73bea4f11787a43e8238d4bb1b8604cde',
    });
    expect(weights!.parts).toHaveLength(1);
    expect(weights!.parts[0]!.url).toBe(
      'https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/508edd0afaa66bb9e9f40587acc2184f02daf1f6/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf',
    );
    expect(totalBytes(TEXT_MODEL)).toBe(4683072032 + 1354162912);
  });

  it('is downloadable: every model comes from Hugging Face at a pinned revision', () => {
    for (const model of MODEL_REGISTRY) {
      expect(isDownloadable(model)).toBe(true);
      expect(model.licence).toBe('Apache-2.0');
      for (const file of model.files) {
        expect(file.parts[0]!.url).toBe(
          `${model.source}/resolve/${model.sourceRevision}/${file.name}`,
        );
      }
    }
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
    expect(modelsFor('text').map((m) => m.id)).toEqual(MODEL_REGISTRY.map((m) => m.id));
    expect(modelsFor('vision')).toHaveLength(MODEL_REGISTRY.length);
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
    expect(TEXT_MODEL.files.map((f) => f.role)).toEqual(['weights', 'projector', 'projector-lite']);
    // The lighter projector is optional: it is not part of what a download costs.
    expect(TEXT_MODEL.files[2]).toMatchObject({
      optional: true,
      bytes: 853119712,
      sha256: '2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506',
    });
    expect(totalBytes(VISION)).toBe(150);
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
  it('under a research licence is not distributable and never downloadable', () => {
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
    const file = {
      ...VISION.files[0]!,
      bytes: TEXT_MODEL.files[0]!.bytes,
      parts: TEXT_MODEL.files[0]!.parts,
    };
    expect(ModelManifest.safeParse({ ...VISION, files: [file] }).success).toBe(false);
  });

  it('may leave a file unhashed, and nothing else may', () => {
    const { sha256: _gone, ...unpinned } = VISION.files[0]!;
    expect(ModelManifest.safeParse({ ...VISION, files: [unpinned] }).success).toBe(true);
    const released = { ...TEXT_MODEL, files: [{ ...TEXT_MODEL.files[0]!, sha256: undefined }] };
    expect(ModelManifest.safeParse(released).success).toBe(false);
  });

  it('is never offered as the licence of a distributable model', () => {
    for (const m of [...MODEL_REGISTRY, VISION]) {
      if (m.evaluationOnly) expect(m.distributable).toBe(false);
    }
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
      'proofread',
      'compose-email',
    ] as const) {
      expect(capabilityOf({ kind })).toBe('text');
    }
    expect(Object.keys(TASK_CAPABILITY).sort()).toEqual([
      'compose-email',
      'draft-form',
      'draft-reply',
      'proofread',
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

describe('the runtime manifest', () => {
  it('pins a release of llama-server, MIT, with the hash of the archive for this computer', () => {
    expect(LLAMA_SERVER).toMatchObject({ id: 'llama-server', tag: 'b11741', licence: 'MIT' });
    const win = runtimeAssetFor('win32', 'x64')!;
    expect(win).toMatchObject({
      name: 'llama-b11741-bin-win-cpu-x64.zip',
      bytes: 19708452,
      sha256: '2f86ad2fb6e118aedf3b319c554a6ba14bc6888b2d0ff9135e81fb0201da807e',
      entry: 'llama-server.exe',
      verified: true,
    });
    expect(win.contents.some((c) => c.name === 'llama-server-impl.dll')).toBe(true);
  });

  it('also pins the Vulkan build, an optional choice that is never the default', () => {
    const vulkan = runtimeAssetFor('win32', 'x64', LLAMA_SERVER, 'vulkan')!;
    expect(vulkan).toMatchObject({
      name: 'llama-b11741-bin-win-vulkan-x64.zip',
      sha256: '1981b9898b68dc6637077d6c618effaa350f5939ee75e9a4d803508708413ab5',
      verified: true,
    });
    expect(vulkan.contents.some((c) => c.name === 'ggml-vulkan.dll')).toBe(true);
    expect(runtimeAssetFor('win32', 'x64')?.variant).toBeUndefined();
    expect(runtimeAssetFor('linux', 'x64', LLAMA_SERVER, 'vulkan')).toBeUndefined();
    expect(RuntimeManifest.safeParse({ ...LLAMA_SERVER, assets: [vulkan, vulkan] }).success).toBe(
      false,
    );
  });

  it('marks every platform that was not run here as UNVERIFIED, with no contents list', () => {
    for (const asset of LLAMA_SERVER.assets) {
      if (asset.platform !== 'win32-x64') {
        expect(asset.verified, asset.platform).toBe(false);
        expect(asset.contents, asset.platform).toEqual([]);
      }
    }
    expect(runtimeAssetFor('freebsd', 'x64')).toBeUndefined();
  });

  it('is refused when it is inconsistent', () => {
    const win = runtimeAssetFor('win32', 'x64')!;
    const parse = (patch: object) =>
      RuntimeManifest.safeParse({ ...LLAMA_SERVER, ...patch }).success;
    expect(parse({})).toBe(true);
    expect(parse({ tag: 'b1' })).toBe(false); // assets are from another tag
    expect(parse({ assets: [win, win] })).toBe(false); // one platform twice
    expect(parse({ assets: [{ ...win, contents: [] }] })).toBe(false); // verified, no program listed
    expect(parse({ assets: [{ ...win, verified: false }] })).toBe(false); // unverified with a list
    expect(parse({ assets: [{ ...win, url: 'https://example.com/x.zip' }] })).toBe(false);
  });
});
