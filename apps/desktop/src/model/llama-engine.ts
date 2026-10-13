import { availableParallelism } from 'node:os';
import { LlamaChatSession, LlamaLogLevel, getLlama } from 'node-llama-cpp';
import type { Engine, GenerateRequest } from './engine.js';

/**
 * The real engine: `node-llama-cpp` (MIT) running Qwen3-4B-Instruct-2507 on the CPU, in the
 * process that imports this file (`worker.ts`, an Electron utility process; ADR 0023 section 1).
 *
 * The settings are the ones spike S1 measured (`docs/plan/SUMMARY-SPIKE.md` section 8):
 * - `gpu: false`, `build: 'never'`. The app never compiles anything on a person's computer; when
 *   no prebuilt binary loads, that is an error with a reason, not a half-hour of cmake.
 * - Context 4,096, flash attention on, batch 512, `mmap` off (it made no speed difference and
 *   counted the file's pages in the working set).
 * - Temperature 0.2, top-k 40, top-p 0.9, min-p 0.05, repeat penalty 1.05 over 128 tokens, a
 *   fixed seed: low but not zero.
 * - One sequence at a time, a fresh one for each call.
 *
 * This file imports the runtime and is never imported by anything that runs in the window or in
 * the main process: only `worker.ts` does, and `build.ts` leaves `node-llama-cpp` out of its bundle.
 */
export const CONTEXT_TOKENS = 4096;

const SAMPLING = {
  temperature: 0.2,
  topK: 40,
  topP: 0.9,
  minP: 0.05,
  seed: 7,
  repeatPenalty: { penalty: 1.05, lastTokens: 128 },
} as const;

/**
 * Threads: physical cores minus one, between 2 and 8. Node reports logical processors; on a
 * machine with two threads to a core that is twice the physical count. Spike S1 measured eight
 * threads only on eight performance cores, and a laptop with efficiency cores is not that.
 */
export function chooseThreads(
  logical: number = availableParallelism(),
  platform: string = process.platform,
): number {
  const physical = platform === 'darwin' ? logical : Math.round(logical / 2);
  return Math.min(8, Math.max(2, physical - 1));
}

export async function loadLlamaEngine(
  modelPath: string,
  options: { threads?: number } = {},
): Promise<Engine> {
  const llama = await getLlama({ gpu: false, build: 'never', logLevel: LlamaLogLevel.error });
  const model = await llama.loadModel({ modelPath, useMmap: false });
  const context = await model.createContext({
    contextSize: CONTEXT_TOKENS,
    batchSize: 512,
    flashAttention: true,
    threads: options.threads ?? chooseThreads(),
  });

  const grammars = new Map<number, Awaited<ReturnType<typeof makeGrammar>>>();
  const makeGrammar = (choose: number) =>
    llama.createGrammarForJsonSchema({
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
    } as never);
  const grammarFor = async (choose: number) => {
    let grammar = grammars.get(choose);
    if (!grammar) {
      grammar = await makeGrammar(choose);
      grammars.set(choose, grammar);
    }
    return grammar;
  };

  return {
    countTokens: (text) => model.tokenize(text).length,

    async generate(request: GenerateRequest) {
      const sequence = context.getSequence();
      try {
        const session = new LlamaChatSession({
          contextSequence: sequence,
          systemPrompt: request.system,
        });
        const grammar = request.choose === undefined ? undefined : await grammarFor(request.choose);
        const answer = await session.prompt(request.user, {
          ...SAMPLING,
          maxTokens: request.maxTokens,
          ...(grammar ? { grammar } : {}),
          signal: request.signal,
          stopOnAbortSignal: true,
          ...(request.onText ? { onTextChunk: request.onText } : {}),
          ...(request.onTokens
            ? { onToken: (tokens: readonly number[]) => request.onTokens?.(tokens.map(String)) }
            : {}),
        });
        return answer;
      } finally {
        sequence.dispose();
      }
    },

    async dispose() {
      await context.dispose();
      await model.dispose();
      await llama.dispose();
    },
  };
}
