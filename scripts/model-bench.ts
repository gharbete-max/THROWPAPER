/**
 * OPT-IN, never part of `pnpm verify`: runs catalogue models for real. For each id it downloads the
 * model with Loppa's own download manager (host allow-list, streaming SHA-256), starts the pinned
 * llama-server on it and measures, on the same invented invoice page and Swedish summary, the load
 * time, the process's peak memory, tokens per second, the time to read a page and whether the
 * expected strings came back. Prints one JSON line per model.
 *
 *   pnpm exec tsx scripts/model-bench.ts <work-dir> <runtime-dir> <model-id>...
 *
 * `<work-dir>` receives the model files (kept, so a second run downloads nothing).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeAssetFor, findModel, isAllowedHost, totalBytes } from '@tp/shared/ai';
import { downloadFile } from '../apps/desktop/src/ai/download.js';
import {
  DEFAULT_SETTINGS,
  startServer,
  type RunningServer,
} from '../apps/desktop/src/ai/server/llama-server.js';
import { createServerTextEngine } from '../apps/desktop/src/ai/server/server-text-engine.js';
import { runJob, type Sink } from '../apps/desktop/src/ai/text/pipeline.js';

const [work, runtime, ...ids] = process.argv.slice(2);
if (!work || !runtime || ids.length === 0)
  throw new Error('usage: <work-dir> <runtime-dir> <id>...');
const asset = runtimeAssetFor(process.platform, process.arch)!;

const INVOICE_HTML = `<html><body style="font-family:Arial;font-size:15px;width:760px;margin:30px">
<h1 style="margin:0">FAKTURA 2026-0417</h1><p>Hallsta Trädgårdsförening, Rosenvägen 4, 123 45 Hallsta</p>
<p>Fakturadatum: 2026-10-01 &nbsp; Förfallodatum: 2026-10-31 &nbsp; Bankgiro: 123-4567</p>
<table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse">
<tr style="background:#eee"><th align="left">Beskrivning</th><th>Antal</th><th align="right">À-pris</th><th align="right">Summa</th></tr>
<tr><td>Gräsfrö, 5 kg</td><td align="center">3</td><td align="right">249,00</td><td align="right">747,00</td></tr>
<tr><td>Rosenspadar</td><td align="center">2</td><td align="right">189,50</td><td align="right">379,00</td></tr>
<tr><td>Frakt</td><td align="center">1</td><td align="right">99,00</td><td align="right">99,00</td></tr></table>
<p align="right">Summa exkl. moms: 1 225,00 kr<br>Moms 25 %: 306,25 kr<br><b>Att betala: 1 531,25 kr</b></p>
<p>OCR-nummer: 1234567897 &nbsp; [x] Betalas via bankgiro &nbsp; [ ] Betalas via Swish</p></body></html>`;
const EXPECT = [
  'FAKTURA 2026-0417',
  'Gräsfrö',
  '249,00',
  '747,00',
  'Rosenspadar',
  '189,50',
  '379,00',
  '99,00',
  '1 531,25',
  '1234567897',
  '2026-10-31',
  '123-4567',
];

function peakBytes(pid: number | undefined): number {
  if (!pid) return 0;
  const out = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).PeakWorkingSet64`],
    { encoding: 'utf8' },
  ).stdout;
  return Number(out.trim()) || 0;
}

async function chat(server: RunningServer, content: unknown, maxTokens: number) {
  const started = Date.now();
  const response = await fetch(`${server.connection.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${server.connection.apiKey}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });
  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    timings: {
      prompt_n: number;
      prompt_ms: number;
      predicted_n: number;
      predicted_per_second: number;
    };
  };
  return {
    text: json.choices[0]!.message.content,
    timings: json.timings,
    seconds: (Date.now() - started) / 1000,
  };
}

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 820, height: 760 } });
await page.setContent(INVOICE_HTML);
const png = await page.screenshot({ type: 'png' });
await browser.close();
const image = {
  type: 'image_url',
  image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
};
const ask = {
  type: 'text',
  text: 'Read this page. Return all its text and structure as Markdown. Keep the table as a table and mark checkboxes as [x] or [ ].',
};
const swedish = readFileSync('fixtures/demo/summary-sv.txt', 'utf8');

for (const id of ids) {
  const model = findModel(id);
  if (!model) throw new Error(`unknown model ${id}`);
  const result: Record<string, unknown> = { id, downloadBytes: totalBytes(model) };
  try {
    const t0 = Date.now();
    const paths: Record<string, string> = {};
    for (const file of model.files.filter((f) => !f.optional)) {
      paths[file.role] = await downloadFile({
        file,
        dir: work,
        fetch: (input, init) => fetch(input, init),
        allowHost: isAllowedHost,
      });
    }
    result.downloadSeconds = (Date.now() - t0) / 1000;

    const loadStarted = Date.now();
    const server = await startServer({
      entry: join(runtime, asset.entry),
      files: { weights: paths.weights!, projector: paths.projector! },
      settings: { ...DEFAULT_SETTINGS, threads: 8 },
      signal: new AbortController().signal,
    });
    result.loadSeconds = (Date.now() - loadStarted) / 1000;
    try {
      const read = await chat(server, [image, ask], 700);
      const found = EXPECT.filter((e) => read.text.includes(e));
      result.page = {
        seconds: read.seconds,
        promptTokens: read.timings.prompt_n,
        tokensPerSecond: read.timings.predicted_per_second,
        found: `${found.length}/${EXPECT.length}`,
        missing: EXPECT.filter((e) => !found.includes(e)),
        sample: read.text.slice(0, 300),
      };
      let text = '';
      const sink: Sink = {
        step: () => undefined,
        text: (mode, piece) => (text = mode === 'replace' ? piece : text + piece),
        selected: () => undefined,
      };
      const started = Date.now();
      await runJob(
        createServerTextEngine(server.connection),
        { kind: 'summarise', text: swedish, into: 'sv-SE', shape: 'document' },
        sink,
        new AbortController().signal,
      );
      result.summary = {
        seconds: (Date.now() - started) / 1000,
        chars: text.length,
        sample: text.slice(0, 300),
      };
      result.peakRamBytes = peakBytes(server.pid);
    } finally {
      await server.kill();
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  console.log(JSON.stringify(result));
}
