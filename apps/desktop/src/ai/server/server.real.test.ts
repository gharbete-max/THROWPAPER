import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { freemem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LLAMA_SERVER, TEXT_MODEL, runtimeAssetFor } from '@tp/shared/ai';
import type { JobWarning, ModelJob, ReplyTask } from '@tp/shared/summary';
import { runJob, type Sink } from '../text/pipeline.js';
import { DEFAULT_SETTINGS, startServer, type RunningServer } from './llama-server.js';
import { createServerTextEngine, estimateTokens, streamChat } from './server-text-engine.js';
import { describeFolder, verifyRuntimeFolder } from '../runtime.js';

/**
 * OPT-IN, never part of `pnpm verify`: the real model through the real `llama-server`
 * (ADR 0025). It loads the model, reads text, writes summaries, a translation and an email draft,
 * reads one picture of a page, and prints what it took.
 *
 *   LOPPA_REAL_MODEL=1 LOPPA_AI_DIR=C:\dir-with-the-two-gguf-files \
 *   LOPPA_RUNTIME_DIR=<local-models/runtime> pnpm exec vitest run apps/desktop/src/ai/server/server.real.test.ts
 *
 * What it asserts is only what Loppa guarantees whatever the model writes. How GOOD the output is
 * is read from the printed lines by a person. Peak memory is the process's own peak working set
 * (Windows) or resident set (elsewhere); "memory after kill" is the computer's free memory, which
 * other programs also move, so it is a plausibility check and not a precise figure.
 */
const DIR = process.env['LOPPA_AI_DIR'] ?? '';
const RUNTIME =
  process.env['LOPPA_RUNTIME_DIR'] ??
  resolve(import.meta.dirname, '../../../../../local-models/runtime');
const enabled = process.env['LOPPA_REAL_MODEL'] === '1' && DIR !== '';
const weights = (): string => join(DIR, TEXT_MODEL.files.find((f) => f.role === 'weights')!.name);
const projector = (): string =>
  join(DIR, TEXT_MODEL.files.find((f) => f.role === 'projector')!.name);
const asset = runtimeAssetFor(process.platform, process.arch)!;
const gb = (bytes: number) => (bytes / 1e9).toFixed(2);
const log = (line: string) => console.log(`[real] ${line}`);

function peakBytes(pid: number | undefined): number {
  if (!pid) return 0;
  if (process.platform === 'win32') {
    const out = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).PeakWorkingSet64`],
      { encoding: 'utf8' },
    ).stdout;
    return Number(out.trim()) || 0;
  }
  return (
    (Number(spawnSync('ps', ['-o', 'rss=', '-p', `${pid}`], { encoding: 'utf8' }).stdout) || 0) *
    1024
  );
}

/** Connections held by the process that are not to this computer itself. */
function outsideConnections(pid: number | undefined): string[] {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout.split(/\r?\n/);
  return out.filter((line) => {
    const cols = line.trim().split(/\s+/);
    if (!/^(TCP|UDP)$/.test(cols[0] ?? '')) return false;
    if (cols[cols.length - 1] !== `${pid}`) return false;
    const foreign = cols[0] === 'TCP' ? cols[2]! : cols[2]!;
    return !/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0:0|\[::\]:0|\*:\*)/.test(foreign);
  });
}

interface Timings {
  prompt_n: number;
  prompt_ms: number;
  predicted_n: number;
  predicted_ms: number;
  predicted_per_second: number;
}

async function chatOnce(server: RunningServer, content: unknown, maxTokens: number) {
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
    timings: Timings;
  };
  return {
    text: json.choices[0]!.message.content,
    timings: json.timings,
    seconds: (Date.now() - started) / 1000,
  };
}

const CORPUS = resolve(import.meta.dirname, '../../../../../docs/plan/spike-s1/corpus');
const corpus = (name: string) => readFileSync(join(CORPUS, name), 'utf8');

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

describe.skipIf(!enabled)('the real model through llama-server', () => {
  it('has the pinned program, unchanged', async () => {
    expect(await verifyRuntimeFolder(RUNTIME, asset)).toBe('ok');
    expect((await describeFolder(RUNTIME)).length).toBe(asset.contents.length);
    log(`runtime ${LLAMA_SERVER.tag}, ${asset.name}, ${asset.contents.length} files verified`);
  });

  it('loads, summarises, translates, drafts and reads a page, and gives the memory back', async () => {
    const freeBefore = freemem();
    const loadStarted = Date.now();
    let server = await startServer({
      entry: join(RUNTIME, asset.entry),
      files: { weights: weights(), projector: projector() },
      settings: { ...DEFAULT_SETTINGS, threads: 8 },
      signal: new AbortController().signal,
    });
    log(
      `load (model + projector, 8 threads, ctx ${DEFAULT_SETTINGS.contextTokens}): ${((Date.now() - loadStarted) / 1000).toFixed(1)} s; free memory ${gb(freeBefore)} -> ${gb(freemem())} GB`,
    );
    const engine = createServerTextEngine(server.connection);

    const run = async (label: string, job: ModelJob | ReplyTask) => {
      let text = '';
      const sink: Sink = {
        step: () => undefined,
        text: (mode, piece) => (text = mode === 'replace' ? piece : text + piece),
        selected: () => undefined,
      };
      const started = Date.now();
      const outcome = await runJob(engine, job, sink, new AbortController().signal);
      log(
        `${label}: ${((Date.now() - started) / 1000).toFixed(1)} s, warnings ${outcome.warnings.map((w: JobWarning) => w.kind).join(';') || 'none'}\n---\n${text}\n---`,
      );
      expect(text.trim().length).toBeGreaterThan(0);
      return text;
    };

    try {
      // tokeniser calibration for estimateTokens, over the whole spike corpus
      const low: string[] = [];
      let worst = 0;
      for (const name of readdirSync(CORPUS).filter((n) => n.endsWith('.txt'))) {
        const text = readFileSync(join(CORPUS, name), 'utf8');
        const response = await fetch(`${server.connection.baseUrl}/tokenize`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${server.connection.apiKey}`,
          },
          body: JSON.stringify({ content: text }),
        });
        const real = ((await response.json()) as { tokens: unknown[] }).tokens.length;
        const ratio = estimateTokens(text) / real;
        worst = Math.max(worst, ratio);
        if (ratio < 1) low.push(`${name} ${real} vs ${estimateTokens(text)}`);
        log(
          `tokens ${name}: real ${real}, estimate ${estimateTokens(text)} (x${ratio.toFixed(2)})`,
        );
      }
      log(
        `estimate is at most x${worst.toFixed(2)} of the real count; below it for: ${low.join(', ') || 'none'}`,
      );
      expect(low).toEqual([]);

      await run('summary, English', {
        kind: 'summarise',
        text: corpus('en.one.txt'),
        into: 'en-GB',
        shape: 'document',
      });
      await run('summary, Swedish', {
        kind: 'summarise',
        text: corpus('sv.one.txt'),
        into: 'sv-SE',
        shape: 'document',
      });
      await run('translation, Swedish to English', {
        kind: 'translate',
        text: corpus('sv.one.txt'),
        into: 'en-GB',
      });
      await run('email reply', {
        kind: 'draft-reply',
        received:
          'Hej! Kan du komma på styrelsemötet nästa vecka och prata om takrenoveringen? Hälsningar Eva',
        notes: 'Ja, jag kan komma. Fråga om det kostar något.',
        into: 'sv-SE',
        tone: 'friendly',
      });

      // one picture of a page
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 820, height: 760 } });
      await page.setContent(INVOICE_HTML);
      const png = await page.screenshot({ type: 'png' });
      await browser.close();
      writeFileSync(join(tmpdir(), 'loppa-real-invoice.png'), png);
      const image = {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
      };
      const ask = {
        type: 'text',
        text: 'Read this page. Return all its text and structure as Markdown. Keep the table as a table and mark checkboxes as [x] or [ ].',
      };

      for (const threads of [8, 4]) {
        if (threads !== 8) {
          await server.kill();
          server = await startServer({
            entry: join(RUNTIME, asset.entry),
            files: { weights: weights(), projector: projector() },
            settings: { ...DEFAULT_SETTINGS, threads },
            signal: new AbortController().signal,
          });
        }
        const read = await chatOnce(server, [image, ask], 700);
        log(
          `page read, ${threads} threads: ${read.seconds.toFixed(1)} s; prompt ${read.timings.prompt_n} tokens in ${(read.timings.prompt_ms / 1000).toFixed(1)} s; ${read.timings.predicted_n} tokens out at ${read.timings.predicted_per_second.toFixed(2)} tok/s\n---\n${read.text}\n---`,
        );
        expect(read.text).toMatch(/1\s?531/);
        const text = await chatOnce(server, 'Write two sentences about gardens.', 80);
        log(
          `text speed, ${threads} threads: ${text.timings.predicted_per_second.toFixed(2)} tok/s (prompt ${text.timings.prompt_n} tokens)`,
        );
      }

      const peak = peakBytes(server.pid);
      log(`peak memory of the server process: ${gb(peak)} GB`);
      const outside = outsideConnections(server.pid);
      log(
        `connections that are not to this computer: ${outside.length === 0 ? 'none' : outside.join(' | ')}`,
      );
      expect(outside).toEqual([]);

      // streamChat honours a cancel
      const stop = new AbortController();
      let pieces = 0;
      const cancelled = streamChat(
        server.connection,
        {
          messages: [{ role: 'user', content: 'Count from 1 to 500, one number per line.' }],
          max_tokens: 1500,
        },
        stop.signal,
        () => {
          if (++pieces === 5) stop.abort();
        },
      );
      expect((await cancelled).length).toBeGreaterThan(0);
      expect(pieces).toBeLessThan(60);
    } finally {
      const killStarted = Date.now();
      await server.kill();
      log(`kill: ${((Date.now() - killStarted) / 1000).toFixed(1)} s, exited ${server.exited}`);
    }
    expect(server.exited).toBe(true);
    await new Promise((r) => setTimeout(r, 3000));
    log(`free memory after kill: ${gb(freemem())} GB (before load ${gb(freeBefore)} GB)`);
  }, 1_800_000);

  it('compares the f16 and the Q8_0 projector on the same pages', async () => {
    const lite = join(DIR, TEXT_MODEL.files.find((f) => f.role === 'projector-lite')!.name);
    const FORM_HTML = `<html><body style="font-family:Arial;font-size:14px;width:760px;margin:30px">
<h2>Anmälan till odlingsdag 2026-05-16</h2><p>Namn: Maja Berg &nbsp; Lott nr: 41 &nbsp; Telefon: 070-123 45 67</p>
<p>[x] Jag kan hjälpa till med bygget &nbsp; [ ] Jag tar med kaffe &nbsp; [x] Jag vill ha faktura</p>
<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:11px"><tr><th>Dag</th><th>Tid</th><th>Plats</th></tr>
<tr><td>Lördag</td><td>09:30</td><td>Klubbhuset</td></tr><tr><td>Söndag</td><td>11:00</td><td>Odlingslotterna</td></tr></table>
<p style="font-size:9px">Avgift 150 kr betalas senast 2026-05-02 till bankgiro 765-4321.</p></body></html>`;
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const shots: Array<{ name: string; png: Buffer; expect: string[] }> = [];
    for (const [name, html, expected] of [
      [
        'invoice',
        INVOICE_HTML,
        [
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
        ],
      ],
      [
        'form',
        FORM_HTML,
        [
          '2026-05-16',
          'Maja Berg',
          '41',
          '070-123 45 67',
          'Klubbhuset',
          '09:30',
          'Söndag',
          '11:00',
          'Odlingslotterna',
          '150 kr',
          '2026-05-02',
          '765-4321',
        ],
      ],
    ] as const) {
      const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
      await page.setContent(html);
      shots.push({ name, png: await page.screenshot({ type: 'png' }), expect: [...expected] });
    }
    await browser.close();
    const ask = {
      type: 'text',
      text: 'Read this page. Return all its text and structure as Markdown. Keep tables as tables and mark checkboxes as [x] or [ ].',
    };

    for (const [label, projectorFile] of [
      ['f16', projector()],
      ['Q8_0', lite],
    ] as const) {
      const freeBefore = freemem();
      const server = await startServer({
        entry: join(RUNTIME, asset.entry),
        files: { weights: weights(), projector: projectorFile },
        settings: { ...DEFAULT_SETTINGS, threads: 8 },
        signal: new AbortController().signal,
      });
      try {
        for (const shot of shots) {
          const image = {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${shot.png.toString('base64')}` },
          };
          const read = await chatOnce(server, [image, ask], 700);
          const found = shot.expect.filter((e) => read.text.includes(e));
          const boxes = (read.text.match(/[x]/g) ?? []).length;
          log(`${label}, ${shot.name}: ${read.seconds.toFixed(1)} s, prompt ${read.timings.prompt_n} tokens in ${(read.timings.prompt_ms / 1000).toFixed(1)} s, ${read.timings.predicted_per_second.toFixed(1)} tok/s; ${found.length}/${shot.expect.length} expected strings found (missing: ${shot.expect.filter((e) => !found.includes(e)).join(' | ') || 'none'}); [x] marks: ${boxes}
---
${read.text}
---`);
        }
        log(
          `${label}: peak memory ${gb(peakBytes(server.pid))} GB; free memory ${gb(freeBefore)} -> ${gb(freemem())} GB`,
        );
      } finally {
        await server.kill();
      }
    }
  }, 1_800_000);
});
