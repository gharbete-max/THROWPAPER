/**
 * OPT-IN, never part of `pnpm verify`: one reading-speed measurement of the page reader
 * (docs/plan/VISION-TUNING.md). It starts the pinned `llama-server` on a model with the server
 * arguments Loppa uses today, changed by the flags below, reads the invented pages of the real-model
 * suite (apps/desktop/src/ai/reader.real.test.ts) with the production prompt and schema and prints
 * one JSON line per run: seconds per page, prompt and answer tokens, tokens per second, how many of
 * the known strings were found, the process's peak memory and how busy the rest of the machine was.
 *
 *   pnpm exec tsx scripts/vision-tune.ts --weights <gguf> --proj <gguf> --runtime <dir> --pages <dir>
 *     [--label x] [--only invoice,table] [--threads 8] [--mask 0x5555] [--extra "-b 4096 -ub 1024"]
 *     [--ctx 8192] [--image-max 2560] [--max-tokens 2400] [--out file.jsonl]
 *
 * `--dump <file>` also appends each raw answer to that file.
 * `--extra` is appended to the arguments, so it overrides anything above it. `--mask` pins the
 * threads to those logical processors (`-C <mask> --cpu-strict 1`), which keeps a run on the same
 * cores whatever else the machine is doing.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { MODEL_PAGE_SCHEMA, pageFromModel, pageText, runtimeAssetFor } from '@tp/shared/ai';
import { PAGE_SYSTEM } from '../apps/desktop/src/ai/vision/read-page.js';
import {
  DEFAULT_SETTINGS,
  defaultSpawn,
  startServer,
  type SpawnFn,
} from '../apps/desktop/src/ai/server/llama-server.js';
import { SAMPLING } from '../apps/desktop/src/ai/server/server-text-engine.js';

const { values: o } = parseArgs({
  options: {
    weights: { type: 'string' },
    proj: { type: 'string' },
    runtime: { type: 'string' },
    pages: { type: 'string' },
    label: { type: 'string', default: 'run' },
    only: { type: 'string' },
    threads: { type: 'string', default: '8' },
    mask: { type: 'string' },
    extra: { type: 'string', default: '' },
    ctx: { type: 'string', default: `${DEFAULT_SETTINGS.contextTokens}` },
    'image-max': { type: 'string', default: `${DEFAULT_SETTINGS.imageMaxTokens}` },
    'max-tokens': { type: 'string', default: '2400' },
    // the schema and prompt before docs/plan/VISION-TUNING.md: a table as cells with row and column
    legacy: { type: 'boolean', default: false },
    out: { type: 'string' },
    dump: { type: 'string' },
  },
});
const need = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`--${name} is required`);
  return v;
};
const asset = runtimeAssetFor(process.platform, process.arch)!;

/** Strings that must be found on each page, as printed (the same lists as reader.real.test.ts). */
const EXPECTED: Record<string, string[]> = {
  invoice: [
    'Nordisk Testbolag AB',
    'Faktura',
    '2026-10-31',
    '2026-11-30',
    '114',
    'Konsulttjänst oktober',
    '10 000,00',
    '2 000,00',
    '12 000,00',
    '3 000,00',
    '15 000,00',
    '123-4566',
    '202611497',
  ],
  table: [
    'Kvartalsrapport',
    'Norr',
    'Mitt',
    'Syd',
    'Väst',
    'Öst',
    '352 400',
    '675 000',
    '935 750',
    '280 120',
    '207 300',
    '2026-10-12',
  ],
  form: [
    'Anmälan till årsmötet',
    'Anna Lindqvist',
    '48213',
    'anna.lindqvist@example.org',
    '070-555 01 42',
    '2026-11-14',
    'middagen',
    'tolk',
    'röstkort',
  ],
  text: [
    'Rapport från trädgårdsgruppen',
    'odlingslådorna',
    'åttiotal',
    'Tomaterna',
    'försommarväder',
    'saft och bullar',
    'ordföranden',
  ],
  photo: [
    'Rapport från trädgårdsgruppen',
    'odlingslådorna',
    'åttiotal',
    'Tomaterna',
    'försommarväder',
    'saft och bullar',
    'ordföranden',
  ],
};
const FILE: Record<string, string> = { photo: 'photo.jpg' };
/** The page shape before 2026-10-20: a table as a list of cells, each with its row and column. */
const LEGACY_SCHEMA = structuredClone(MODEL_PAGE_SCHEMA) as unknown as {
  properties: { blocks: { items: { properties: Record<string, unknown> } } };
};
const legacyProps = LEGACY_SCHEMA.properties.blocks.items.properties;
delete legacyProps['rows'];
legacyProps['cells'] = {
  type: 'array',
  maxItems: 150,
  items: {
    type: 'object',
    properties: {
      row: { type: 'integer', minimum: 0, maximum: 60 },
      column: { type: 'integer', minimum: 0, maximum: 20 },
      text: { type: 'string', maxLength: 300 },
    },
    required: ['row', 'column', 'text'],
    additionalProperties: false,
  },
};
const LEGACY_SYSTEM = PAGE_SYSTEM.replace(
  '"table" (its rows, top to bottom, each a list of the texts of its cells, left to right, an empty cell as "")',
  '"table" (every cell, with its row and column counted from 0)',
);

const squash = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

/** Logical processors' busy time, for how busy the machine was beside this run. */
const busy = () =>
  cpus().map((c) => ({
    idle: c.times.idle,
    total: Object.values(c.times).reduce((a, b) => a + b, 0),
  }));
function load(before: ReturnType<typeof busy>, after: ReturnType<typeof busy>, skip: Set<number>) {
  const use = after.map((a, i) => ({
    i,
    idle: a.idle - before[i]!.idle,
    total: a.total - before[i]!.total,
  }));
  const rest = use.filter((u) => !skip.has(u.i));
  return Math.round((100 * rest.reduce((s, u) => s + (1 - u.idle / u.total), 0)) / rest.length);
}

function peakBytes(pid: number | undefined): number {
  if (!pid) return 0;
  const out = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).PeakWorkingSet64`],
    { encoding: 'utf8' },
  ).stdout;
  return Number(out.trim()) || 0;
}

const mask = o.mask ? BigInt(o.mask) : null;
const pinned = new Set<number>();
if (mask) for (let i = 0; i < 64; i++) if ((mask >> BigInt(i)) & 1n) pinned.add(i);
const extra = o.extra!.split(/\s+/).filter(Boolean);
const spawn: SpawnFn = (command, args, cwd) =>
  defaultSpawn()(
    command,
    [...args, ...(mask ? ['-C', o.mask!, '--cpu-strict', '1'] : []), ...extra],
    cwd,
  );

const settings = {
  contextTokens: Number(o.ctx),
  imageMaxTokens: Number(o['image-max']),
  threads: Number(o.threads),
};
const loadStarted = Date.now();
const server = await startServer({
  entry: join(need(o.runtime, 'runtime'), asset.entry),
  files: { weights: need(o.weights, 'weights'), projector: need(o.proj, 'proj') },
  settings,
  spawn,
  signal: new AbortController().signal,
});
const loadSeconds = (Date.now() - loadStarted) / 1000;

const pages = (o.only ?? Object.keys(EXPECTED).join(',')).split(',');
const rows: Array<Record<string, unknown>> = [];
try {
  for (const name of pages) {
    const png = readFileSync(join(need(o.pages, 'pages'), FILE[name] ?? `${name}.png`));
    const type = name === 'photo' ? 'jpeg' : 'png';
    const before = busy();
    const started = Date.now();
    const response = await fetch(`${server.connection.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${server.connection.apiKey}`,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: o.legacy ? LEGACY_SYSTEM : PAGE_SYSTEM },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/${type};base64,${png.toString('base64')}` },
              },
              { type: 'text', text: 'Read this page and answer with the JSON.' },
            ],
          },
        ],
        max_tokens: Number(o['max-tokens']),
        ...SAMPLING,
        temperature: 0.1,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'page',
            strict: true,
            schema: o.legacy ? LEGACY_SCHEMA : MODEL_PAGE_SCHEMA,
          },
        },
      }),
    });
    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      timings: Record<string, number>;
    };
    const seconds = (Date.now() - started) / 1000;
    const answer = json.choices[0]!.message.content;
    if (o.dump)
      appendFileSync(
        o.dump,
        `### ${o.label} ${name}
${answer}
`,
      );
    const page = pageFromModel(1, answer);
    const text = squash(pageText(page));
    const strings = EXPECTED[name]!;
    const hits = strings.filter((s) => text.includes(squash(s)));
    const t = json.timings;
    rows.push({
      page: name,
      seconds,
      promptTokens: t['prompt_n'],
      cachedTokens: t['cache_n'],
      promptMs: Math.round(t['prompt_ms']!),
      answerTokens: t['predicted_n'],
      answerMs: Math.round(t['predicted_ms']!),
      tokPerS: Number(t['predicted_per_second']!.toFixed(2)),
      found: `${hits.length}/${strings.length}`,
      missed: strings.filter((s) => !hits.includes(s)),
      status: page.status,
      otherLoadPercent: load(before, busy(), pinned),
    });
  }
} finally {
  const peak = peakBytes(server.pid);
  await server.kill();
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const result = {
    label: o.label,
    extra: o.extra,
    mask: o.mask ?? null,
    threads: o.threads,
    loadSeconds,
    peakGB: Number((peak / 1e9).toFixed(2)),
    totalSeconds: Number(sum('seconds').toFixed(1)),
    found:
      rows.reduce((s, r) => s + Number(String(r['found']).split('/')[0]), 0) +
      '/' +
      rows.reduce((s, r) => s + Number(String(r['found']).split('/')[1]), 0),
    rows,
  };
  const line = JSON.stringify(result);
  console.log(line);
  if (o.out) appendFileSync(o.out, line + '\n');
}
