import { appendFileSync, readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LLAMA_SERVER,
  TEXT_MODEL,
  pageText,
  runtimeAssetFor,
  StructuredPage,
  type AiTask,
} from '@tp/shared/ai';
import type { JobWarning } from '@tp/shared/summary';
import type { EngineEvent } from './engine.js';
import { ServerEngine } from './engines/server-engine.js';

/**
 * OPT-IN, never part of `pnpm verify`: the AI reader, the proofreader and the corporate email on
 * the real model (docs/plan/AI-SYSTEM.md D4/D6). It reads five pictures of pages (an invoice, a
 * table, a form, a Swedish text page and a degraded photograph of it), proofreads an invented
 * summary with five planted mistakes, and writes two emails. It prints what it took and what it
 * found; how GOOD an email is is read from the printed text by a person.
 *
 *   LOPPA_REAL_MODEL=1 LOPPA_AI_DIR=<folder with the two gguf files> LOPPA_PAGES_DIR=<folder with the
 *   page pictures: invoice.png table.png form.png text.png photo.jpg>
 *   LOPPA_RUNTIME_DIR=<local-models/runtime> pnpm exec vitest run apps/desktop/src/ai/reader.real.test.ts
 *
 * What it asserts is only what Loppa guarantees whatever the model writes: a page comes back as a
 * structured page on the page asked for, every proofreading span is in the text, an email quotes
 * what it was asked to quote or says it did not.
 */
const DIR = process.env['LOPPA_AI_DIR'] ?? '';
const PAGES = process.env['LOPPA_PAGES_DIR'] ?? '';
const RUNTIME =
  process.env['LOPPA_RUNTIME_DIR'] ??
  resolve(import.meta.dirname, '../../../../local-models/runtime');
const enabled = process.env['LOPPA_REAL_MODEL'] === '1' && DIR !== '' && PAGES !== '';
const file = (role: 'weights' | 'projector') =>
  join(DIR, TEXT_MODEL.files.find((f) => f.role === role)!.name);
const asset = runtimeAssetFor(process.platform, process.arch)!;
const LOG = process.env['LOPPA_REAL_LOG'];
/** To the console and, when asked, to a file: a runner may hide the console of a passing test. */
const log = (line: string) => {
  console.log(`[reader] ${line}`);
  if (LOG)
    appendFileSync(
      LOG,
      `${line}
`,
    );
};

/** Strings that must be found on each page, as printed. */
const EXPECTED: Record<string, string[]> = {
  'invoice.png': [
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
  'table.png': [
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
  'form.png': [
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
  'text.png': [
    'Rapport från trädgårdsgruppen',
    'odlingslådorna',
    'åttiotal',
    'Tomaterna',
    'försommarväder',
    'saft och bullar',
    'ordföranden',
  ],
  'photo.jpg': [
    'Rapport från trädgårdsgruppen',
    'odlingslådorna',
    'åttiotal',
    'Tomaterna',
    'försommarväder',
    'saft och bullar',
    'ordföranden',
  ],
};

const squash = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

const SUMMARY =
  'Summary of the board meeting\n\nThe board recieved the annual report and discussed the budjet for next year. The members was informed that the roof renovation will start in spring. About 150 members attended the meeting, which was opened by the chair, Mr Berg. The next meeting is on 2026-11-03.';
const SOURCE =
  'Minutes of the board meeting. The board received the annual report and discussed the budget for next year. The members were informed that the roof renovation will start in spring. 120 members attended the meeting, which was opened by the chair, Mrs Eriksson. The next meeting is on 2026-11-03.';
const PLANTED = ['recieved', 'budjet', 'members was', '150', 'Mr Berg'];

describe.skipIf(!enabled)('the AI reader, proofreader and email on the real model', () => {
  it('reads pages, proofreads, writes emails', async () => {
    const engine = new ServerEngine(
      { weights: file('weights'), projector: file('projector') },
      {
        locateRuntime: () => Promise.resolve(join(RUNTIME, asset.entry)),
        totalMemory: totalmem,
        settings: { threads: 8 },
      },
    );
    const loadStarted = Date.now();
    await engine.load(new AbortController().signal);
    log(`load ${LLAMA_SERVER.tag}: ${((Date.now() - loadStarted) / 1000).toFixed(1)} s`);

    const run = async (task: AiTask) => {
      const events: EngineEvent[] = [];
      const started = Date.now();
      const result = await engine.run(task, (e) => events.push(e), new AbortController().signal);
      const last = events.filter((e) => e.kind === 'text').at(-1);
      return {
        text: last && last.kind === 'text' ? last.text : '',
        seconds: (Date.now() - started) / 1000,
        warnings: result.warnings,
      };
    };

    try {
      let found = 0;
      let total = 0;
      // LOPPA_REAL_SKIP_PAGES=1 measures only the proofreader and the emails (a page takes a minute or two).
      const skipPages = process.env['LOPPA_REAL_SKIP_PAGES'] === '1';
      for (const [name, strings] of skipPages ? [] : Object.entries(EXPECTED)) {
        const png = new Uint8Array(readFileSync(join(PAGES, name)));
        const out = await run({
          kind: 'read-page',
          fileSha256: 'a'.repeat(64),
          page: 1,
          png,
          longEdge: 1000,
          turn: 0,
          language: null,
        });
        const page = StructuredPage.parse(JSON.parse(out.text));
        const text = squash(pageText(page));
        const hits = strings.filter((s) => text.includes(squash(s)));
        const missed = strings.filter((s) => !hits.includes(s));
        found += hits.length;
        total += strings.length;
        log(
          `${name}: ${out.seconds.toFixed(1)} s, status ${page.status}${page.reason ? ` (${page.reason})` : ''}, ${page.blocks.length} blocks [${page.blocks.map((b) => b.type).join(',')}], strings ${hits.length}/${strings.length}${missed.length ? ` missed: ${missed.join(' | ')}` : ''}`,
        );
        log(`${name} text:\n${pageText(page)}\n---`);
        expect(page.page).toBe(1);
      }
      log(`accuracy on known strings: ${found}/${total}`);

      // Proofreading with five planted mistakes.
      const proof = await run({ kind: 'proofread', text: SUMMARY, source: SOURCE, into: 'en-GB' });
      const answer = JSON.parse(proof.text) as {
        issues: Array<{
          span: string;
          kind: string;
          fix: string | null;
          start: number;
          end: number;
        }>;
        rejected: number;
      };
      for (const issue of answer.issues) {
        expect(SUMMARY.slice(issue.start, issue.end)).toBe(issue.span);
      }
      const hit = (planted: string) =>
        answer.issues.some((i) => i.span.includes(planted) || planted.includes(i.span));
      const foundPlanted = PLANTED.filter(hit);
      const falseOnes = answer.issues.filter(
        (i) => !PLANTED.some((p) => i.span.includes(p) || p.includes(i.span)),
      );
      log(
        `proofread: ${proof.seconds.toFixed(1)} s, ${answer.issues.length} issues, planted found ${foundPlanted.length}/5 (${foundPlanted.join(', ')}), missed ${PLANTED.filter((p) => !hit(p)).join(', ') || 'none'}, other issues ${falseOnes.length} (${falseOnes.map((i) => `"${i.span}"->${i.fix === null ? '(look)' : `"${i.fix}"`}`).join('; ')}), dropped by verification ${answer.rejected}`,
      );
      log(JSON.stringify(answer.issues));

      // Emails.
      const show = (label: string, r: { text: string; seconds: number; warnings: JobWarning[] }) =>
        log(
          `${label}: ${r.seconds.toFixed(1)} s, warnings ${r.warnings.map((w) => w.kind).join(';') || 'none'}\n---\n${r.text}\n---`,
        );
      show(
        'summary email, English, formal',
        await run({
          kind: 'compose-email',
          purpose: 'summary',
          material: SUMMARY,
          recipient: 'Anna Berg',
          notes: '',
          into: 'en-GB',
          tone: 'formal',
          overall: 'good',
          quotes: [],
        }),
      );
      const material = answer.issues
        .map(
          (i, n) =>
            `${n + 1}. ${i.kind}: "${i.span}"${i.fix === null ? ' (not in the source)' : ` -> "${i.fix}"`}`,
        )
        .join('\n');
      for (const [into, label] of [
        ['en-GB', 'English'],
        ['sv-SE', 'Swedish'],
      ] as const) {
        const email = await run({
          kind: 'compose-email',
          purpose: 'feedback',
          material,
          recipient: 'Anna Berg',
          notes: '',
          into,
          tone: 'formal',
          overall: 'good',
          quotes: answer.issues.map((i) => i.span),
        });
        show(`feedback email, ${label}`, email);
      }
    } finally {
      await engine.dispose();
    }
  }, 3_600_000);
});
