import { z } from 'zod';
import { LocalisedText } from '../api/common.js';
import { FormDefinition } from '../forms/definition.js';
import type { Change } from './changes.js';
import { JsonSchema, type BuilderGraph } from './graph/schema.js';
import { resume, type Answer, type Conversation, type LogEntry } from './machine.js';
import { MachineError, type BuilderState } from './state.js';

/**
 * A conversation as it is saved — `GET/PUT /v1/forms/:id/builder-session`, one row per form and
 * author in `builder_sessions` (`PREDICTIVE-BUILDER.md`, "The conversation", Autosave).
 *
 * The base state and the log, nothing derived: the current node is where the log leads. These
 * schemas are the endpoints' documentation as well as their validation (`CAVEATS.md` #40: the
 * Forms-internal endpoints are documented by their Zod schemas, not by `CONTRACT.md`).
 */

export const SESSION_VERSION = 1;

/**
 * The longest log a session may hold. A conversation of a thousand steps is already far past any
 * form anyone builds by answering questions; this bounds what one request can make the server
 * store.
 */
export const MAX_LOG_ENTRIES = 2000;

const selector = z.union([
  z.object({ id: z.string() }).strict(),
  z.object({ value: z.string() }).strict(),
]);
const pointer = z.array(z.union([z.string(), selector])).min(1);

const ChangeSchema: z.ZodType<Change> = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), at: pointer, value: JsonSchema }).strict(),
  z.object({ op: z.literal('unset'), at: pointer }).strict(),
  z
    .object({ op: z.literal('insert'), at: pointer, value: JsonSchema, after: selector.nullable() })
    .strict(),
  z.object({ op: z.literal('remove'), at: pointer }).strict(),
  z.object({ op: z.literal('reorder'), at: pointer, after: selector.nullable() }).strict(),
]);

const AnswerSchema: z.ZodType<Answer> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option'), optionId: z.string() }).strict(),
  z.object({ kind: z.literal('options'), optionIds: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('quantity'), value: z.number().int() }).strict(),
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z.object({ kind: z.literal('guess'), verdict: z.enum(['right', 'sort-of', 'no']) }).strict(),
  z.object({ kind: z.literal('continue') }).strict(),
  z.object({ kind: z.literal('jump'), to: z.string() }).strict(),
  z.object({ kind: z.literal('edit') }).strict(),
]);

const source = z.enum(['guided', 'import', 'manual']);

const LogEntrySchema: z.ZodType<LogEntry> = z
  .object({
    nodeId: z.string(),
    answer: AnswerSchema,
    patch: z.array(ChangeSchema),
    inverse: z.array(ChangeSchema),
    to: z.string(),
    skipped: z.array(
      z
        .object({ nodeId: z.string(), reason: z.string().regex(/^guided\.[a-zA-Z0-9.]+$/) })
        .strict() as z.ZodType<{ nodeId: string; reason: `guided.${string}` }>,
    ),
    tier: z.enum(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']).nullable(),
    source,
  })
  .strict();

const slots = z
  .object({
    kind: z.boolean(),
    required: z.boolean(),
    options: z.boolean(),
    shape: z.boolean(),
    placement: z.boolean(),
    validation: z.boolean(),
  })
  .partial()
  .strict();

const StateSchema = z
  .object({
    draft: z.object({ definition: FormDefinition, title: LocalisedText }).strict(),
    sidecar: z
      .object({
        provenance: z.enum(['guided', 'import', 'mixed']),
        fields: z.record(
          z
            .object({
              source,
              nodeId: z.string().optional(),
              decided: slots.optional(),
              setAside: z.record(JsonSchema).optional(),
            })
            .strict(),
        ),
        retiredIds: z.array(z.string()),
        brandDecided: z.enum(['organisation', 'default']).optional(),
      })
      .strict(),
    pending: z.record(JsonSchema),
    focus: z.string().nullable(),
    guess: z.object({ templateId: z.string(), pMille: z.number().int() }).strict().nullable(),
    cursor: z.string(),
  })
  .strict();

export const BuilderSession = z
  .object({
    sessionVersion: z.literal(SESSION_VERSION),
    /** The graph it was recorded against. Replay does not need it; the trail's wording does. */
    graphVersion: z.number().int().positive(),
    base: StateSchema,
    log: z.array(LogEntrySchema).max(MAX_LOG_ENTRIES),
  })
  .strict();
export type BuilderSession = z.infer<typeof BuilderSession>;

/** `PUT /v1/forms/:id/builder-session`: the session, and the version it was read at (0: none). */
export const SaveBuilderSession = z
  .object({ version: z.number().int().min(0), session: BuilderSession })
  .strict();
export type SaveBuilderSession = z.infer<typeof SaveBuilderSession>;

/** `GET` and `PUT`: the stored session and its version; no session yet is version 0 and null. */
export const BuilderSessionResponse = z.object({
  version: z.number().int().min(0),
  session: BuilderSession.nullable(),
});
export type BuilderSessionResponse = z.infer<typeof BuilderSessionResponse>;

/** `PUT`'s answer: the version the session is now at, which the next save names. */
export const BuilderSessionSaved = z.object({ version: z.number().int().positive() });
export type BuilderSessionSaved = z.infer<typeof BuilderSessionSaved>;

/** A conversation as it is saved. */
export function toSession(graph: BuilderGraph, conversation: Conversation): BuilderSession {
  return BuilderSession.parse({
    sessionVersion: SESSION_VERSION,
    graphVersion: graph.graphVersion,
    base: conversation.base,
    log: conversation.log,
  });
}

/**
 * A saved conversation, replayed. It came from outside — a server, a disk, another build — so
 * anything wrong with it is one error: `bad-session`, which the shell answers by offering to
 * start again rather than by guessing.
 */
export function fromSession(stored: unknown): Conversation {
  const parsed = BuilderSession.safeParse(stored);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MachineError(
      'bad-session',
      `${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`,
    );
  }
  try {
    return resume(parsed.data.base as BuilderState, parsed.data.log);
  } catch (error) {
    if (error instanceof MachineError) throw new MachineError('bad-session', error.message);
    throw error;
  }
}
