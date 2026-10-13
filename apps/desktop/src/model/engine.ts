/**
 * The seam between the pipeline and a language model.
 *
 * The pipeline (`pipeline.ts`) is everything Loppa decides: how a text is cut, what is asked, what
 * is checked, when to stop. An engine is only "complete this prompt". The real one is
 * `llama-engine.ts` (node-llama-cpp, CPU, in a utility process); `fake-engine.ts` is the one CI and
 * the end-to-end tests run, so the whole path is exercised without a 2.5 GB file.
 */
export interface GenerateRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Aborting stops generation at the next token and resolves with what exists. */
  signal: AbortSignal;
  /**
   * When set, the answer is constrained by a grammar to `{"indices":[...]}` with every number
   * from 1 to `choose` and at most five of them. The model cannot name a passage that is not there.
   */
  choose?: number;
  /** New text as it is written. */
  onText?: (text: string) => void;
  /** Token identifiers as they are written, for the loop guard. */
  onTokens?: (tokens: readonly string[]) => void;
}

export interface Engine {
  /** The model's own tokeniser: chunk sizes and output caps are in its tokens. */
  countTokens(text: string): number;
  generate(request: GenerateRequest): Promise<string>;
  /** Frees the model's memory. */
  dispose(): Promise<void>;
}

/** The pipeline stopped for a reason a person can read. `problem` is a `ModelProblem`. */
export class JobError extends Error {
  constructor(
    readonly problem:
      | 'too-long'
      | 'language-refused'
      | 'quote-only'
      | 'cancelled'
      | 'failed'
      | 'cannot-start'
      | 'too-little-memory'
      | 'damaged'
      | 'not-installed',
    message?: string,
  ) {
    super(message ?? problem);
    this.name = 'JobError';
  }
}
