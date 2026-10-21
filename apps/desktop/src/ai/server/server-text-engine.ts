import type { GenerateRequest, TextEngine } from '../text/text-engine.js';
import type { Connection } from './llama-server.js';

/**
 * "Complete this prompt" over `llama-server`'s OpenAI-style `/v1/chat/completions`, streamed
 * (ADR 0025). Everything Loppa decides is in `text/pipeline.ts`; this only carries one call.
 *
 * Sampling is the one spike S1 measured for the summary pipeline: low but not zero temperature,
 * top-k 40, top-p 0.9, min-p 0.05, repeat penalty 1.05 over 128 tokens, a fixed seed.
 *
 * Cancel is an aborted request: the server notices the closed connection and stops generating, and
 * the call resolves with the text that exists, as {@link TextEngine} promises.
 */
export const SAMPLING = {
  temperature: 0.2,
  top_k: 40,
  top_p: 0.9,
  min_p: 0.05,
  seed: 7,
  repeat_penalty: 1.05,
  repeat_last_n: 128,
} as const;

/**
 * Tokens in a text, without asking the server: the chunker needs an answer at once. It is meant to
 * be a little high, never low: a text cut by it fits the context. Calibrated against the server's
 * own `/tokenize` over the 36 files of the spike corpus (twelve languages, three sizes), where it
 * lands between 1.01 and 1.61 times the real count; the real-model suite re-checks that. A digit is
 * a token of its own, a newline is one, an ASCII letter about a third, a letter with a mark
 * (a, o, d, th) about one, a Cyrillic letter under half, anything else (Chinese, Japanese) one.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x30 && code <= 0x39) tokens += 1;
    else if (/\s/.test(ch)) tokens += ch === '\n' ? 1 : 0.1;
    else if (code < 0x80 && /\p{L}/u.test(ch)) tokens += 0.36;
    else if (code < 0x250 && /\p{L}/u.test(ch)) tokens += 1.2;
    else if (code >= 0x400 && code < 0x530) tokens += 0.45;
    else tokens += 1;
  }
  return Math.ceil(tokens * 1.1);
}

/** The server answered, but not with a completion. */
export class ServerHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`llama-server answered ${status}: ${body.slice(0, 300)}`);
    this.name = 'ServerHttpError';
  }
}

export interface ChatBody {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>;
  max_tokens: number;
  response_format?: unknown;
  [key: string]: unknown;
}

/** One streamed chat completion. Resolves with the text written so far when `signal` aborts. */
export async function streamChat(
  connection: Connection,
  body: ChatBody,
  signal: AbortSignal,
  onDelta: (text: string) => void = () => undefined,
): Promise<string> {
  let text = '';
  try {
    const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new ServerHttpError(response.status, await response.text().catch(() => ''));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return text;
        const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> })
          .choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta !== '') {
          text += delta;
          onDelta(delta);
        }
      }
    }
    // The server always ends a stream with [DONE]. A stream that just stops is a process that died
    // (or a connection that was cut) and the text so far is not an answer: it must not pass for one.
    throw new Error('llama-server closed the stream before the answer was complete');
  } catch (error) {
    if (signal.aborted) return text;
    throw error;
  }
}

const indicesSchema = (choose: number) => ({
  type: 'object',
  properties: {
    indices: {
      type: 'array',
      items: { type: 'integer', enum: Array.from({ length: choose }, (_, i) => i + 1) },
      minItems: 1,
      maxItems: 5,
    },
  },
  required: ['indices'],
  additionalProperties: false,
});

export function createServerTextEngine(connection: Connection): TextEngine {
  return {
    countTokens: estimateTokens,

    generate(request: GenerateRequest) {
      return streamChat(
        connection,
        {
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          max_tokens: request.maxTokens,
          ...SAMPLING,
          ...(request.choose === undefined && request.schema === undefined
            ? {}
            : {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: request.schema?.name ?? 'passages',
                    strict: true,
                    schema: request.schema?.schema ?? indicesSchema(request.choose!),
                  },
                },
              }),
        },
        request.signal,
        (piece) => {
          request.onText?.(piece);
          // One streamed piece is one token for the loop guard, which compares them with each other.
          request.onTokens?.([piece]);
        },
      );
    },

    // The process is the engine's; killing it is what gives the memory back.
    dispose: () => Promise.resolve(),
  };
}
