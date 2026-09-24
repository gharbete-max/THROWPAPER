import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Sign's own database (`docs/adr/0009-where-signing-lives.md`). Nothing here is reachable from
 * Forms or Mailer except through `docs/CONTRACT.md` §5.
 *
 * **Append-only.** Documents, declarations, envelopes and their events are refused UPDATE, DELETE
 * and TRUNCATE by a trigger (`drizzle/0001_append_only.sql`), so a signed record cannot be edited
 * by this code or any other. An envelope's state is never stored: it is what
 * `@tp/signing`'s `replay` makes of the event trail, which is hash-chained to the envelope's
 * definition — so an edit made by somebody who first disabled the trigger is detected on the next
 * read. The only mutable table is `service_tokens`, which is access control, not evidence.
 */

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

/** A caller of the §5 API: one per organisation and product that calls Sign. Stored as a hash. */
export const serviceTokens = pgTable('service_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  name: text('name').notNull(),
  tokenSha256: text('token_sha256').notNull().unique(),
  /**
   * The only origins Sign will fetch a `documentUrl` from or post a `hookUrl` to, for this caller.
   * Sign makes outbound requests on a caller's say-so; without this list, a caller could point it
   * at anything on Sign's own network.
   */
  allowedOrigins: text('allowed_origins').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** A document, by the SHA-256 of its bytes. Content-addressed, so it cannot change under a key. */
export const documents = pgTable('documents', {
  sha256: text('sha256').primaryKey(),
  bytes: bytea('bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The declaration a signer approves, per locale (ADR 0012). Written by a person, never generated
 * (CLAUDE.md rule 8). A change is a new version; an envelope pins the version it was sent with.
 *
 * `testOnly` marks the bracketed placeholder the seed writes: usable in test mode, refused for a
 * production envelope, so nothing real is ever signed against text nobody authored.
 *
 * `organisationId` is whose words these are. A person in that organisation writes them through
 * CONTRACT §5.5 (never Loppa: rule 8); only that organisation's envelopes can use them. Null is a
 * shared placeholder — the seed's, test-only — which every organisation may use in test mode.
 */
export const declarations = pgTable(
  'declarations',
  {
    organisationId: uuid('organisation_id'),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    /** `{ [locale]: text }`, byte for byte as shown to the signer. */
    texts: jsonb('texts').$type<Record<string, string>>().notNull(),
    testOnly: boolean('test_only').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Null is one owner, not many: the shared placeholders' versions are unique too.
    unique('declarations_owner_key_version')
      .on(table.organisationId, table.key, table.version)
      .nullsNotDistinct(),
  ],
);

/**
 * An envelope as it was asked for. `definition` is the exact JSON text the trail is chained to —
 * text, not jsonb, because jsonb reorders keys and the hash is over bytes.
 */
export const envelopes = pgTable(
  'envelopes',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    documentSha256: text('document_sha256')
      .notNull()
      .references(() => documents.sha256),
    definition: text('definition').notNull(),
    definitionSha256: text('definition_sha256').notNull(),
    /**
     * The token that asked for it. §5.4 events are signed with that token's hash, which only Sign
     * and the holder of the token can compute. Null on envelopes created before P1c-3.
     */
    serviceTokenId: uuid('service_token_id').references(() => serviceTokens.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('envelopes_idempotency').on(table.organisationId, table.idempotencyKey),
    index('envelopes_organisation_idx').on(table.organisationId),
  ],
);

/**
 * The sealed PDF of a completed envelope — one per envelope, written in the same transaction as the
 * signature that completed it, never replaced (append-only, `drizzle/0002_sealed_documents.sql`).
 *
 * `trailSha256` is the event the seal was made over: a trail that has grown since cannot have been
 * sealed, and a read that finds a later event than this refuses the row as corrupt.
 */
export const sealedDocuments = pgTable('sealed_documents', {
  envelopeId: uuid('envelope_id')
    .primaryKey()
    .references(() => envelopes.id),
  sha256: text('sha256').notNull(),
  bytes: bytea('bytes').notNull(),
  trailSha256: text('trail_sha256').notNull(),
  /** SHA-256 of the seal certificate's DER, so a rotated key leaves each seal attributable. */
  certificateSha256: text('certificate_sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The audit trail. `sha256` = SHA-256(`prevSha256` + "\n" + `event`); seq 1 chains to the definition. */
export const envelopeEvents = pgTable(
  'envelope_events',
  {
    envelopeId: uuid('envelope_id')
      .notNull()
      .references(() => envelopes.id),
    seq: integer('seq').notNull(),
    event: text('event').notNull(),
    prevSha256: text('prev_sha256').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.envelopeId, table.seq] })],
);
