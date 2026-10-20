import {
  StructuredPage,
  crossCheck,
  failedPage,
  renumber,
  type AiBridge,
  type AiProblem,
  type ReadQuality,
} from '@tp/shared/ai';

/**
 * Reading a document page by page with the AI reader (docs/plan/AI-SYSTEM.md D4).
 *
 * One page at a time, in order: a picture is drawn, handed to the model on this computer, and let
 * go before the next is drawn, so a long PDF is never held as pictures. Each answer is checked as
 * a `StructuredPage`, compared with the page's own text layer when it has one (a large mismatch
 * makes the page `uncertain`), and given its place in the document. A page that fails is listed
 * with why and the rest go on; a problem that would fail every page (no model, no memory) stops the
 * run, and the pages not reached stay unread. Nothing here touches the original.
 */
export interface ReadablePage {
  /** Hash of the file this page is in, and its place there (from 1): the cache key's two halves. */
  fileSha256: string;
  pageInFile: number;
  turn: 0 | 90 | 180 | 270;
  language: string | null;
  /** The page drawn within the budget of `quality`: a PNG or JPEG, and the pixels of its long side. */
  picture(quality: ReadQuality): Promise<{ bytes: Uint8Array; longEdge: number }>;
  /** The page's own text, or null when it has none to compare with (a photograph). */
  layer(): Promise<string | null>;
}

/** Problems that would be the same for every page: the run stops instead of listing each. */
const STOPS: ReadonlySet<AiProblem> = new Set([
  'not-installed',
  'damaged',
  'too-little-memory',
  'cannot-start',
  'busy',
  'not-available',
  'consent-required',
]);

type Outcome = { text: string } | { problem: AiProblem };

function runOne(
  bridge: AiBridge,
  task: Parameters<AiBridge['run']>[1],
  signal: AbortSignal,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    let text = '';
    const finish = (outcome: Outcome) => {
      off();
      signal.removeEventListener('abort', stop);
      resolve(outcome);
    };
    const off = bridge.onEvent((event) => {
      if (event.id !== id) return;
      if (event.kind === 'text') text = event.mode === 'replace' ? event.text : text + event.text;
      else if (event.kind === 'done') finish({ text });
      else if (event.kind === 'error') finish({ problem: event.problem });
    });
    const stop = () => void bridge.cancel(id);
    signal.addEventListener('abort', stop, { once: true });
    void bridge.run(id, task).then((started) => {
      if (!started.ok) finish({ problem: started.problem });
    });
  });
}

export interface ReadRun {
  bridge: AiBridge;
  pages: readonly ReadablePage[];
  /** Which pages to read, 0-based, in this order. */
  indexes: readonly number[];
  quality: ReadQuality;
  signal: AbortSignal;
  /** `reading` as one starts; `done` with its page; `stopped` with the problem that ended the run. */
  onPage(index: number, state: 'reading' | 'done', page?: StructuredPage): void;
}

export async function readPages(run: ReadRun): Promise<{ stopped: AiProblem | null }> {
  for (const index of run.indexes) {
    if (run.signal.aborted) return { stopped: 'cancelled' };
    const source = run.pages[index]!;
    const number = index + 1;
    run.onPage(index, 'reading');
    let outcome: Outcome;
    try {
      const picture = await source.picture(run.quality);
      if (run.signal.aborted) return { stopped: 'cancelled' };
      outcome = await runOne(
        run.bridge,
        {
          kind: 'read-page',
          fileSha256: source.fileSha256,
          page: source.pageInFile,
          png: picture.bytes,
          longEdge: picture.longEdge,
          turn: source.turn,
          language: source.language,
        },
        run.signal,
      );
    } catch {
      // The page could not even be drawn.
      run.onPage(index, 'done', failedPage(number, 'failed'));
      continue;
    }
    if ('problem' in outcome) {
      if (outcome.problem === 'cancelled') return { stopped: 'cancelled' };
      if (STOPS.has(outcome.problem)) return { stopped: outcome.problem };
      run.onPage(index, 'done', failedPage(number, outcome.problem));
      continue;
    }
    let page: StructuredPage;
    try {
      const parsed = StructuredPage.safeParse(JSON.parse(outcome.text));
      page = parsed.success ? parsed.data : failedPage(number, 'unreadable-output');
    } catch {
      page = failedPage(number, 'unreadable-output');
    }
    const layer = page.status === 'failed' ? null : await source.layer().catch(() => null);
    run.onPage(index, 'done', renumber(layer ? crossCheck(page, layer) : page, number));
  }
  return { stopped: null };
}
