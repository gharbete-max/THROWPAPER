import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import {
  apply,
  draftEnvelope,
  EnvelopeEvent,
  replay,
  type Envelope,
  type Refusal,
} from '@tp/signing';
import type { Db } from '../db/client.js';
import {
  documents,
  envelopeEvents,
  envelopes,
  sealedDocuments,
  serviceTokens,
} from '../db/schema.js';
import type { Sealer } from '../sealing/certificate.js';
import { sealEnvelope } from '../sealing/seal.js';
import type { HookDelivery } from './hooks.js';
import type { SigningHookEvent } from '@tp/shared/contract';

/** What reading and appending to an envelope needs: the database, and the key a completion seals with. */
export interface Store {
  db: Db;
  sealer: Sealer;
  /** §5.4. Absent, nothing is posted — the tests that do not ask about hooks. */
  hooks?: HookDelivery;
}

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** One link of the trail: what this event is, bound to everything before it. */
export function chain(prevSha256: string, event: string): string {
  return sha256(`${prevSha256}\n${event}`);
}

/**
 * Everything an envelope was created with. Stored as exact JSON text and hashed: the trail's first
 * link chains to this hash, so an edit to the parties, the document or the organisation is an edit
 * to the chain.
 */
export interface Definition {
  organisationId: string;
  envelope: Omit<Envelope, 'status' | 'partyStatus' | 'evidence'>;
  declaration: { key: string; version: number };
  hookUrl: string | null;
}

/** The stored trail does not verify. Never acted on, never shown as a state. */
export class TrailBroken extends Error {
  constructor(envelopeId: string, why: string) {
    super(`envelope ${envelopeId}: audit trail does not verify (${why})`);
  }
}

/**
 * Stores a new envelope, sent, in one transaction. Returns `created: false` with the existing id
 * when the caller's idempotency key was already used — a retried request, not a second envelope.
 */
export async function createEnvelope(
  db: Db,
  input: {
    definition: Definition;
    idempotencyKey: string;
    document: Uint8Array;
    at: Date;
    /** The token that asked; §5.4 events are signed for it. */
    serviceTokenId?: string;
  },
): Promise<{ id: string; created: boolean }> {
  const { definition } = input;
  const text = JSON.stringify(definition);
  const id = definition.envelope.id;

  return db.transaction(async (tx) => {
    await tx
      .insert(documents)
      .values({ sha256: definition.envelope.documentSha256, bytes: input.document })
      .onConflictDoNothing();
    const [inserted] = await tx
      .insert(envelopes)
      .values({
        id,
        organisationId: definition.organisationId,
        idempotencyKey: input.idempotencyKey,
        documentSha256: definition.envelope.documentSha256,
        definition: text,
        definitionSha256: sha256(text),
        serviceTokenId: input.serviceTokenId ?? null,
      })
      .onConflictDoNothing({ target: [envelopes.organisationId, envelopes.idempotencyKey] })
      .returning({ id: envelopes.id });

    if (!inserted) {
      const [existing] = await tx
        .select({ id: envelopes.id })
        .from(envelopes)
        .where(
          and(
            eq(envelopes.organisationId, definition.organisationId),
            eq(envelopes.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (!existing) throw new Error('idempotency conflict without a row');
      return { id: existing.id, created: false };
    }

    const sent = JSON.stringify(EnvelopeEvent.parse({ type: 'sent', at: input.at.toISOString() }));
    const prev = sha256(text);
    await tx
      .insert(envelopeEvents)
      .values({ envelopeId: id, seq: 1, event: sent, prevSha256: prev, sha256: chain(prev, sent) });
    return { id, created: true };
  });
}

export interface Loaded {
  organisationId: string;
  definition: Definition;
  /** Current after every successful `append`. */
  readonly envelope: Envelope;
  /** The trail, in order, and the hash of its last event. Current after every `append`. */
  readonly events: readonly EnvelopeEvent[];
  readonly trailSha256: string;
  /**
   * The transaction this envelope is locked in. Anything read while acting on it goes through
   * this, never the pool: on PGlite (the desktop edition) there is one connection, and a read
   * outside the transaction that holds it waits forever.
   */
  db: Db;
}

export type Append = (event: EnvelopeEvent) => Promise<Refusal | null>;

/**
 * Loads an envelope under a row lock, verifies its whole trail, and lets `act` append to it.
 *
 * The lock is what makes two signers pressing at once safe: the second waits, then sees the first
 * one's event. Every read verifies the chain from the definition forward, so a trail edited behind
 * the trigger's back throws {@link TrailBroken} instead of becoming somebody's signed document.
 *
 * An envelope past its expiry is expired here, as an event, the first time anyone looks — the
 * state is always what the trail says, never a comparison each caller has to remember to make.
 *
 * **An envelope completed here is sealed here**, in the same transaction, before it commits. So
 * there is no moment at which an envelope is completed and unsealed, and no second code path that
 * has to remember to seal: whatever appended the last signature, the seal came with it. A seal that
 * fails rolls the signature back with it — the signer sees an error and can press again, rather
 * than leaving a completed envelope nobody can download.
 */
export async function withEnvelope<T>(
  store: Store,
  envelopeId: string,
  now: Date,
  act: (loaded: Loaded, append: Append) => Promise<T>,
): Promise<T | null> {
  // Filled inside the transaction, posted only after it commits: a hook about an event that then
  // rolled back would tell the caller something that never happened.
  let outbox: { hookUrl: string; tokenSha256: string; events: SigningHookEvent[] } | null = null;

  const result = await store.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(envelopes)
      .where(eq(envelopes.id, envelopeId))
      .for('update');
    if (!row) return null;

    if (sha256(row.definition) !== row.definitionSha256) {
      throw new TrailBroken(envelopeId, 'definition');
    }
    const definition = JSON.parse(row.definition) as Definition;
    if (
      definition.organisationId !== row.organisationId ||
      definition.envelope.documentSha256 !== row.documentSha256 ||
      definition.envelope.id !== row.id
    ) {
      throw new TrailBroken(envelopeId, 'row disagrees with its definition');
    }

    const rows = await tx
      .select()
      .from(envelopeEvents)
      .where(eq(envelopeEvents.envelopeId, envelopeId))
      .orderBy(asc(envelopeEvents.seq));

    let prev = row.definitionSha256;
    const events = rows.map((stored, index) => {
      if (stored.seq !== index + 1) throw new TrailBroken(envelopeId, `gap at ${index + 1}`);
      if (stored.prevSha256 !== prev || chain(prev, stored.event) !== stored.sha256) {
        throw new TrailBroken(envelopeId, `event ${stored.seq}`);
      }
      prev = stored.sha256;
      return EnvelopeEvent.parse(JSON.parse(stored.event));
    });

    const replayed = replay(draftEnvelope(definition.envelope), events);
    if (!replayed.ok) throw new TrailBroken(envelopeId, `event ${replayed.index + 1} refused`);

    let envelope = replayed.envelope;
    let seq = rows.length;
    const trail = [...events];
    const append: Append = async (event) => {
      const result = apply(envelope, event);
      if (!result.ok) return result.reason;
      const text = JSON.stringify(EnvelopeEvent.parse(event));
      const hash = chain(prev, text);
      seq += 1;
      await tx
        .insert(envelopeEvents)
        .values({ envelopeId, seq, event: text, prevSha256: prev, sha256: hash });
      prev = hash;
      envelope = result.envelope;
      trail.push(event);
      return null;
    };
    const wasCompleted = envelope.status === 'completed';

    if (envelope.status === 'sent' && now.getTime() >= Date.parse(envelope.expiresAt)) {
      await append({ type: 'expired', at: now.toISOString() });
    }

    const answer = await act(
      {
        organisationId: row.organisationId,
        definition,
        db: tx as unknown as Db,
        get envelope() {
          return envelope;
        },
        get events() {
          return trail;
        },
        get trailSha256() {
          return prev;
        },
      },
      append,
    );

    if (!wasCompleted && envelope.status === 'completed') {
      const [document] = await tx
        .select({ bytes: documents.bytes })
        .from(documents)
        .where(eq(documents.sha256, row.documentSha256));
      if (!document) throw new TrailBroken(envelopeId, 'document missing');
      const bytes = await sealEnvelope(
        {
          document: document.bytes,
          envelope,
          events: trail,
          declaration: definition.declaration,
          trailSha256: prev,
          sealedAt: now,
        },
        store.sealer,
      );
      await tx.insert(sealedDocuments).values({
        envelopeId,
        sha256: sha256(bytes),
        bytes,
        trailSha256: prev,
        certificateSha256: store.sealer.fingerprint,
      });
    }

    const appended = trail.slice(events.length);
    if (definition.hookUrl && row.serviceTokenId && appended.length) {
      const [token] = await tx
        .select({ sha256: serviceTokens.tokenSha256 })
        .from(serviceTokens)
        .where(eq(serviceTokens.id, row.serviceTokenId));
      if (token) {
        const hookEvents: SigningHookEvent[] = appended.map((event) => ({
          envelopeId,
          ...('partyId' in event ? { partyId: event.partyId } : {}),
          event: event.type,
          at: event.at,
        }));
        // Completion is a state the trail arrives at, not an event in it; the caller still wants to hear it.
        if (!wasCompleted && envelope.status === 'completed') {
          hookEvents.push({ envelopeId, event: 'completed', at: now.toISOString() });
        }
        outbox = { hookUrl: definition.hookUrl, tokenSha256: token.sha256, events: hookEvents };
      }
    }

    return answer;
  });

  if (outbox) store.hooks?.deliver(outbox);
  return result;
}

/**
 * The seal of a completed envelope, checked against the trail it claims to cover. `null` when the
 * envelope has none; a row whose bytes or trail do not match is corruption, never served.
 */
export async function readSeal(
  db: Db,
  envelopeId: string,
  trailSha256: string,
): Promise<{ sha256: string; bytes: Uint8Array } | null> {
  const [row] = await db
    .select()
    .from(sealedDocuments)
    .where(eq(sealedDocuments.envelopeId, envelopeId));
  if (!row) return null;
  if (row.trailSha256 !== trailSha256)
    throw new TrailBroken(envelopeId, 'seal covers another trail');
  if (sha256(row.bytes) !== row.sha256) throw new TrailBroken(envelopeId, 'sealed bytes');
  return { sha256: row.sha256, bytes: row.bytes };
}

export async function documentBytes(db: Db, documentSha256: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ bytes: documents.bytes })
    .from(documents)
    .where(eq(documents.sha256, documentSha256));
  return row?.bytes ?? null;
}
