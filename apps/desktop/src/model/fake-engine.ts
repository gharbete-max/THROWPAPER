import type { Engine, GenerateRequest } from './engine.js';

/**
 * An {@link Engine} that needs no model: what CI and the desktop's fake mode run.
 *
 * It is deterministic and obviously not a language model. A summary is the first words of what it
 * was given as bullets, a translation is the text in square brackets, and a selection is
 * passage 1. That is enough to prove everything Loppa itself does — the cutting, the order of
 * calls, the streaming, the cancel, the checks, the quoting — without a 2.5 GB file.
 *
 * `behaviour` makes it misbehave on purpose, as the real model did in the spike: `loop` repeats a
 * short run until stopped (the Icelandic failure), `invent` puts a year into its output that the
 * source never had.
 */
export interface FakeBehaviour {
  loop?: boolean;
  invent?: string;
  /** A pause per token-chunk, so a test can cancel in the middle. */
  delayMs?: number;
}

export class FakeEngine implements Engine {
  readonly calls: GenerateRequest[] = [];
  disposed = false;

  constructor(private readonly behaviour: FakeBehaviour = {}) {}

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async generate(request: GenerateRequest): Promise<string> {
    this.calls.push(request);
    if (request.choose !== undefined) return JSON.stringify({ indices: [1] });

    const source =
      /<(?:document|part|form)[^>]*>\n([\s\S]*?)\n<\/(?:document|part|form)/.exec(
        request.user,
      )?.[1] ?? request.user;
    const isTranslation = request.system.startsWith('You are a professional translator');
    const body = isTranslation
      ? `[${source}]`
      : source
          .split(/\n+/)
          .filter((line) => line.trim() !== '')
          .slice(0, 3)
          .map((line) => `- ${line.slice(0, 60)}`)
          .join('\n') + (this.behaviour.invent ? `\n- ${this.behaviour.invent}` : '');

    const pieces = this.behaviour.loop
      ? Array.from({ length: 400 }, (_, i) => ['aðeins ', 'aðeins '][i % 2]!)
      : (body.match(/\S+\s*/g) ?? []);
    let written = '';
    for (const [index, piece] of pieces.entries()) {
      if (request.signal.aborted || index >= request.maxTokens) break;
      if (this.behaviour.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.behaviour.delayMs));
      }
      if (request.signal.aborted) break;
      written += piece;
      request.onText?.(piece);
      request.onTokens?.([piece]);
    }
    return written;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}
