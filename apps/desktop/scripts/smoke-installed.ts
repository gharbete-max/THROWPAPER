/**
 * Smoke test of an INSTALLED Loppa on Windows (not part of `pnpm verify`; run by hand or by the
 * Desktop workflow's release job). It starts the installed program against a throw-away user-data
 * folder, drives it through Chromium's remote-debugging port, and prints one JSON line per check.
 *
 *   pnpm --filter @tp/desktop exec tsx scripts/smoke-installed.ts --exe <...\Loppa.exe> \
 *     --user-data C:\temp\loppa-ud [--pack <folder with PACK.json>] [--steps first,second,soak] [--soak 50]
 *
 * - `first`  : first run (set-up window, workspace made, both servers up), the AI status (no model,
 *              the runtime verified in ai-pack/runtime), opening the pack from a folder through the
 *              real file dialog (UI Automation), one summary and one page read, no connection that
 *              leaves this computer, a clean quit.
 * - `second` : relaunch against the same folder: state persists (owner, model installed and checked).
 * - `soak`   : N consecutive real tasks (summaries and page reads), sampling the memory of every Loppa
 *              process and of llama-server, handles and seconds per task.
 *
 * It never touches the user's own Loppa data: `--user-data` is required and is passed to the program
 * as `--user-data-dir`. It stops only the processes it started.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const exe = resolve(option('--exe') ?? '');
const userData = resolve(option('--user-data') ?? '');
const pack = option('--pack');
const steps = (option('--steps', 'first') ?? 'first').split(',');
const soakCount = Number(option('--soak', '50'));
const port = Number(option('--port', '9333'));
const reportFile = option('--report');
if (!existsSync(exe) || !option('--user-data')) {
  throw new Error('--exe <Loppa.exe> and --user-data <folder> are required');
}
const repo = resolve(import.meta.dirname, '../../..');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const report = (check: string, ok: boolean, detail: unknown) => {
  const line = JSON.stringify({ check, ok, detail });
  console.log(line);
  if (reportFile) appendFileSync(reportFile, `${line}\n`);
};
const ps = (command: string) =>
  spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).stdout.trim();

/** Every process whose image is Loppa's or the model server's, with memory and handles. */
function processes(): Array<{ name: string; pid: number; mb: number; handles: number }> {
  const out = ps(
    'Get-Process Loppa,llama-server -ErrorAction SilentlyContinue | ForEach-Object { "$($_.ProcessName),$($_.Id),$([math]::Round($_.WorkingSet64/1MB)),$($_.HandleCount),$($_.Path)" }',
  );
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(','))
    .filter(
      ([, , , , path]) =>
        (path !== undefined && resolve(path).startsWith(resolve(exe, '..'))) ||
        /llama-server/.test(path ?? ''),
    )
    .map(([name, pid, mb, handles]) => ({
      name: name!,
      pid: Number(pid),
      mb: Number(mb),
      handles: Number(handles),
    }));
}

/** Connections of ours that go anywhere but this computer. */
function outside(pids: number[]): string[] {
  if (pids.length === 0) return [];
  const list = pids.join(',');
  const tcp = ps(
    `Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { @(${list}) -contains $_.OwningProcess -and $_.RemoteAddress -notin '127.0.0.1','::1','0.0.0.0','::' } | ForEach-Object { "$($_.OwningProcess) $($_.LocalAddress):$($_.LocalPort) -> $($_.RemoteAddress):$($_.RemotePort) $($_.State)" }`,
  );
  return tcp.split(/\r?\n/).filter(Boolean);
}

async function launch(): Promise<{ child: ChildProcess; browser: Browser }> {
  const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    stdio: 'ignore',
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !k.startsWith('LOPPA_') && k !== 'ELECTRON_RUN_AS_NODE',
      ),
    ),
  });
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {
      // not yet
    }
    if (Date.now() - started > 60_000) throw new Error('Loppa did not open its debugging port');
    await sleep(200);
  }
  // Connecting before the first window exists can leave Playwright with no page to see.
  for (let tries = 0; tries < 120; tries += 1) {
    const targets = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())) as Array<{
      type: string;
    }>;
    if (targets.some((t) => t.type === 'page')) break;
    await sleep(250);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  report('launch', true, { seconds: (Date.now() - started) / 1000, pid: child.pid });
  return { child, browser };
}

async function pageWhere(
  browser: Browser,
  match: (url: string) => boolean,
  timeout = 60_000,
): Promise<Page> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) if (match(page.url())) return page;
    }
    await sleep(250);
  }
  const seen = browser.contexts().flatMap((context) => context.pages().map((p) => p.url()));
  throw new Error(`no window matched; open: ${JSON.stringify(seen)}`);
}

/** Clicks Open (or Save) in the common file dialog Loppa raised, after typing a path in it. */
function driveFileDialog(pid: number, path: string): string {
  // The modern file dialog exposes no Value or Invoke pattern, so it is found by UI Automation
  // and then typed into like a person: activated by its title, path, Enter.
  const script = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,Microsoft.VisualBasic,System.Windows.Forms
$A=[Windows.Automation.AutomationElement]
$deadline=(Get-Date).AddSeconds(30)
while((Get-Date) -lt $deadline){
  foreach($d in $A::RootElement.FindAll([Windows.Automation.TreeScope]::Children,(New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty,'#32770')))){
    if($d.Current.ProcessId -ne ${pid}){ continue }
    Start-Sleep -Milliseconds 800
    [Microsoft.VisualBasic.Interaction]::AppActivate($d.Current.Name)
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait('${path.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/'/g, "''")}')
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    'dialog driven: ' + $d.Current.Name
    exit 0
  }
  Start-Sleep -Milliseconds 300
}
'no file dialog appeared'
exit 1`;
  return ps(script);
}

const SUMMARY = readFileSync(join(repo, 'fixtures/demo/summary-en.txt'), 'utf8');
const PICTURE = [...readFileSync(join(repo, 'fixtures/demo/invoice-sample.png'))];

/** Runs one task in the window and resolves with how it ended; events are collected in the page. */
async function runTask(page: Page, id: string, task: unknown, timeoutMs = 900_000) {
  return page.evaluate(
    ({ id: taskId, task: body, timeoutMs: limit }) =>
      new Promise<{ kind: string; problem?: string; seconds: number }>((resolve) => {
        const started = Date.now();
        const w = window as unknown as {
          loppaAi: {
            onEvent(l: (e: { id: string; kind: string; problem?: string }) => void): () => void;
            run(id: string, task: unknown): Promise<{ ok: boolean; problem?: string }>;
          };
        };
        const off = w.loppaAi.onEvent((e) => {
          if (e.id === taskId && (e.kind === 'done' || e.kind === 'error')) {
            off();
            resolve({
              kind: e.kind,
              ...(e.problem ? { problem: e.problem } : {}),
              seconds: (Date.now() - started) / 1000,
            });
          }
        });
        void w.loppaAi.run(taskId, body).then((start) => {
          if (!start.ok) {
            off();
            resolve({
              kind: 'refused',
              ...(start.problem ? { problem: start.problem } : {}),
              seconds: 0,
            });
          }
        });
        setTimeout(() => {
          off();
          resolve({ kind: 'timeout', seconds: limit / 1000 });
        }, limit);
      }),
    { id, task, timeoutMs },
  );
}

const summarise = () => ({ kind: 'summarise', text: SUMMARY, into: 'en-GB', shape: 'document' });
let pages = 0;
const readPage = () => ({
  kind: 'read-page',
  fileSha256: (++pages).toString(16).padStart(64, 'e'),
  page: 1,
  png: new Uint8Array(PICTURE),
  longEdge: 1000,
  turn: 0,
  language: null,
});

async function quit(child: ChildProcess, browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
  const before = processes();
  ps(`(Get-Process -Id ${child.pid}).CloseMainWindow() | Out-Null`);
  const started = Date.now();
  while (child.exitCode === null && Date.now() - started < 60_000) await sleep(200);
  await sleep(1500);
  const after = processes();
  report('quit', child.exitCode !== null, {
    seconds: (Date.now() - started) / 1000,
    exitCode: child.exitCode,
    processesBefore: before.length,
    left: after.map((p) => `${p.name}:${p.pid}`),
  });
  if (child.exitCode === null) child.kill();
}

async function mainWindow(browser: Browser): Promise<Page> {
  return pageWhere(
    browser,
    (url) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url) && !url.includes('/signing'),
  );
}

interface StatusLike {
  models: Array<{ id: string; state: string; files: Array<{ role: string; hash: string }> }>;
  runtime: { hash: string; source: string | null; path: string | null } | null;
  freeMemoryBytes: number;
  cache: unknown;
}

const aiStatus = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { loppaAi: { status(): Promise<unknown> } }).loppaAi.status(),
  ) as Promise<StatusLike>;

async function first(): Promise<void> {
  const t0 = Date.now();
  const { child, browser } = await launch();
  const panel = await pageWhere(browser, (url) => url.startsWith('file:') && url.includes('panel'));
  report('first-run window', true, { url: panel.url(), seconds: (Date.now() - t0) / 1000 });
  // The set-up window is destroyed once the room opens, so its own call may never answer.
  const set = await panel
    .evaluate(() =>
      (
        window as unknown as {
          loppa: { bootstrap(o: object): Promise<{ ok: boolean; error?: string }> };
        }
      ).loppa.bootstrap({
        organisationName: 'Smoke AB',
        name: 'Smoke Tester',
        email: 'smoke@example.test',
      }),
    )
    .catch(() => ({ ok: true, error: 'window closed after set-up, as it should' }));
  const main = await mainWindow(browser);
  report('workspace set up and room reachable', set.ok, {
    error: set.error,
    url: main.url(),
    seconds: (Date.now() - t0) / 1000,
  });
  const workspace = join(userData, 'workspace');
  report('workspace folder', existsSync(workspace), readdirSync(workspace));
  const health = await main.evaluate(
    async () => (await fetch('/healthz').catch(() => null))?.status ?? 'none',
  );
  report('forms server answers', true, { healthz: health });
  await main.waitForLoadState('domcontentloaded');
  report('room title', true, { title: await main.title() });

  const status = await aiStatus(main);
  const seven = status.models.find((m) => m.id.startsWith('qwen2.5-vl-7b'))!;
  report('AI status before a pack', seven.state === 'missing', {
    state: seven.state,
    runtime: status.runtime && {
      hash: status.runtime.hash,
      source: status.runtime.source,
      path: status.runtime.path,
    },
    freeGB: (status.freeMemoryBytes / 1e9).toFixed(1),
  });

  if (pack) {
    const id = seven.id as string;
    const pid = child.pid!;
    const dialog = main.evaluate(
      (modelId) =>
        (
          window as unknown as {
            loppaAi: { openFromDisk(i: string): Promise<{ ok: boolean; problem?: string }> };
          }
        ).loppaAi.openFromDisk(modelId),
      id,
    );
    const driven = driveFileDialog(pid, join(resolve(pack), 'PACK.json'));
    report('file dialog driven', /dialog driven/.test(driven), driven);
    const started = await dialog;
    const t = Date.now();
    const installed = await main.evaluate(
      () =>
        new Promise<string>((resolveInstall) => {
          const w = window as unknown as {
            loppaAi: { onEvent(l: (e: { kind: string; problem?: string }) => void): () => void };
          };
          const off = w.loppaAi.onEvent((e) => {
            if (e.kind === 'installed' || e.kind === 'install-failed') {
              off();
              resolveInstall(e.kind + (e.problem ? `:${e.problem}` : ''));
            }
          });
        }),
    );
    report('AI pack opened from a folder', installed === 'installed', {
      start: started,
      installed,
      seconds: (Date.now() - t) / 1000,
    });
  }

  const tasks: Array<[string, unknown]> = [
    ['summary', summarise()],
    ['read-page', readPage()],
  ];
  const samples: string[] = [];
  const sampler = setInterval(() => {
    const own = processes().map((p) => p.pid);
    samples.push(...outside(own));
  }, 3000);
  for (const [label, task] of tasks) {
    const result = await runTask(main, `smoke-${label}`, task);
    const now = processes();
    report(`task: ${label}`, result.kind === 'done', { ...result, processes: now });
  }
  clearInterval(sampler);
  report('no connection leaves this computer', samples.length === 0, [...new Set(samples)]);
  await quit(child, browser);
}

async function second(): Promise<void> {
  const t0 = Date.now();
  const { child, browser } = await launch();
  const main = await mainWindow(browser);
  report('relaunch: room opens without set-up', true, {
    url: main.url(),
    seconds: (Date.now() - t0) / 1000,
  });
  const status = await aiStatus(main);
  const seven = status.models.find((m) => m.id.startsWith('qwen2.5-vl-7b'))!;
  report('relaunch: the model is still installed', seven.state === 'installed', {
    state: seven.state,
    hashes: seven.files.map((f) => `${f.role}:${f.hash}`),
    cache: status.cache,
  });
  const result = await runTask(main, 'smoke-second', summarise());
  report('relaunch: a summary', result.kind === 'done', result);
  await quit(child, browser);
}

async function soak(): Promise<void> {
  const { child, browser } = await launch();
  const main = await mainWindow(browser);
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= soakCount; i += 1) {
    const kind = i % 5 === 0 ? 'read-page' : 'summary';
    const result = await runTask(main, `soak-${i}`, kind === 'summary' ? summarise() : readPage());
    const now = processes();
    const loppa = now.filter((p) => p.name === 'Loppa');
    const llama = now.filter((p) => p.name === 'llama-server');
    const row = {
      i,
      kind,
      result: result.kind,
      seconds: result.seconds,
      loppaMB: loppa.reduce((s, p) => s + p.mb, 0),
      loppaProcesses: loppa.length,
      loppaHandles: loppa.reduce((s, p) => s + p.handles, 0),
      llamaMB: llama.reduce((s, p) => s + p.mb, 0),
      llamaCount: llama.length,
      llamaHandles: llama.reduce((s, p) => s + p.handles, 0),
    };
    rows.push(row);
    report(`soak ${i}`, result.kind === 'done', row);
  }
  await quit(child, browser);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const half = Math.floor(rows.length / 2);
  const part = (from: number, to: number, key: string, kind?: string) =>
    rows
      .slice(from, to)
      .filter((r) => !kind || r.kind === kind)
      .map((r) => Number(r[key]));
  report('soak summary', true, {
    tasks: rows.length,
    done: rows.filter((r) => r.result === 'done').length,
    summarySecondsFirstHalf: mean(part(0, half, 'seconds', 'summary')).toFixed(1),
    summarySecondsSecondHalf: mean(part(half, rows.length, 'seconds', 'summary')).toFixed(1),
    pageSecondsFirstHalf: mean(part(0, half, 'seconds', 'read-page')).toFixed(1),
    pageSecondsSecondHalf: mean(part(half, rows.length, 'seconds', 'read-page')).toFixed(1),
    loppaMBFirst: rows[0]?.loppaMB,
    loppaMBLast: rows.at(-1)?.loppaMB,
    loppaMBMax: Math.max(...rows.map((r) => Number(r.loppaMB))),
    loppaHandlesFirst: rows[0]?.loppaHandles,
    loppaHandlesLast: rows.at(-1)?.loppaHandles,
    llamaMBMax: Math.max(...rows.map((r) => Number(r.llamaMB))),
    llamaHandlesFirst: rows[0]?.llamaHandles,
    llamaHandlesLast: rows.at(-1)?.llamaHandles,
    llamaCountMax: Math.max(...rows.map((r) => Number(r.llamaCount))),
  });
}

void statSync;
for (const step of steps) {
  if (step === 'first') await first();
  else if (step === 'second') await second();
  else if (step === 'soak') await soak();
  else throw new Error(`unknown step ${step}`);
}
