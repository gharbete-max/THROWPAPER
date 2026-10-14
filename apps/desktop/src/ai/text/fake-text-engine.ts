import type { TextEngine, GenerateRequest } from './text-engine.js';
import { REPLY_SYSTEM_START } from './prompts.js';

const between = (text: string, tag: string): string | undefined =>
  new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text)?.[1];

/**
 * A reply that is obviously not a language model's: a greeting, the first words of what it was
 * given, a placeholder for the date, a closing. A draft built from a draft changes it visibly, so a
 * test can tell shorter, translated and revised apart.
 */
function fakeReply(request: GenerateRequest): string {
  const draft = between(request.user, 'draft');
  if (draft === undefined) {
    const received = between(request.user, 'received_message');
    const notes = between(request.user, 'notes');
    return `Hello,\n\nThank you for your message${received ? ` about: ${received.slice(0, 40)}` : ''}. ${notes ? `${notes.slice(0, 60)}. ` : ''}I can meet on [date?].\n\nKind regards`;
  }
  if (request.system.includes('make it shorter')) return draft.split(/\n+/).slice(0, 2).join('\n');
  if (request.system.includes('translate it into')) return `[${draft}]`;
  return `${draft}\n\n(${between(request.user, 'instruction') ?? ''})`;
}

/**
 * An {@link TextEngine} that needs no model: what CI and the desktop's fake mode run.
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

export class FakeTextEngine implements TextEngine {
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
    const body = request.system.startsWith(REPLY_SYSTEM_START)
      ? fakeReply(request)
      : isTranslation
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
