import type { Role } from '@tp/shared/api';

/**
 * Handlers depend on these interfaces, never on `db` directly.
 *
 * That seam is what lets refresh rotation, reuse detection, role checks and capacity rules be
 * tested without a Postgres to hand — see memory.ts. The Drizzle implementation is the only place
 * that knows about tables.
 */

export interface OrganisationRecord {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  supportedLocales: string[];
}

export interface UserRecord {
  id: string;
  organisationId: string;
  email: string;
  name: string;
  role: Role;
  disabledAt: Date | null;
}

export interface LoginTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  redirectTo: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface EventRecord {
  id: string;
  organisationId: string;
  name: Record<string, string>;
  description: Record<string, string>;
  startsAt: Date;
  endsAt: Date;
  venueName: string | null;
  venueAddress: string | null;
  capacity: number | null;
  registrationClosesAt: Date | null;
  status: 'draft' | 'open' | 'closed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEntryInput {
  organisationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export interface AuditEntryRecord extends AuditEntryInput {
  id: string;
  at: Date;
}

export interface OrganisationRepository {
  findById(id: string): Promise<OrganisationRecord | null>;
  /** v0.1 is single-organisation; this is how a request finds "the" org. */
  first(): Promise<OrganisationRecord | null>;
}

export interface UserRepository {
  findByEmail(organisationId: string, email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface TokenRepository {
  createLoginToken(input: {
    userId: string;
    tokenHash: string;
    redirectTo: string | null;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<LoginTokenRecord>;
  findLoginTokenByHash(tokenHash: string): Promise<LoginTokenRecord | null>;
  /** False when it was already consumed — the caller must treat that as a failed exchange. */
  consumeLoginToken(id: string, at: Date): Promise<boolean>;

  createRefreshToken(input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    rotatedFrom: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(id: string, at: Date): Promise<void>;
  /** Used when a rotated token is presented again: the chain is compromised, kill all of it. */
  revokeFamily(familyId: string, at: Date): Promise<void>;
}

export type EventCreate = Omit<EventRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type EventUpdate = Partial<Omit<EventRecord, 'id' | 'organisationId' | 'createdAt'>>;

export interface EventRepository {
  list(organisationId: string): Promise<EventRecord[]>;
  findById(organisationId: string, id: string): Promise<EventRecord | null>;
  create(input: EventCreate): Promise<EventRecord>;
  update(organisationId: string, id: string, patch: EventUpdate): Promise<EventRecord | null>;
  /** Registrations arrive in phase 3; until then this is always 0. */
  countRegistrations(eventId: string): Promise<number>;
}

export interface FormRecord {
  id: string;
  organisationId: string;
  eventId: string | null;
  slug: string;
  title: Record<string, string>;
  status: 'draft' | 'published' | 'closed' | 'archived';
  draftDefinition: unknown;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  opensAt: Date | null;
  closesAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FormVersionRecord {
  id: string;
  formId: string;
  version: number;
  definition: unknown;
  publishedAt: Date | null;
  translationOverride: boolean;
  createdAt: Date;
}

export type FormCreate = Omit<
  FormRecord,
  'id' | 'createdAt' | 'updatedAt' | 'publishedVersionId' | 'publishedVersion' | 'status'
> & { status?: FormRecord['status'] };

export type FormUpdate = Partial<Omit<FormRecord, 'id' | 'organisationId' | 'createdAt'>>;

export interface FormRepository {
  list(organisationId: string): Promise<FormRecord[]>;
  findById(organisationId: string, id: string): Promise<FormRecord | null>;
  findBySlug(organisationId: string, slug: string): Promise<FormRecord | null>;
  create(input: FormCreate): Promise<FormRecord>;
  update(organisationId: string, id: string, patch: FormUpdate): Promise<FormRecord | null>;

  listVersions(formId: string): Promise<FormVersionRecord[]>;
  findVersion(formId: string, version: number): Promise<FormVersionRecord | null>;
  /** Next version number is derived, not supplied, so two publishes cannot collide on one number. */
  createVersion(input: {
    formId: string;
    definition: unknown;
    translationOverride: boolean;
  }): Promise<FormVersionRecord>;
}

export interface SubmissionRecord {
  id: string;
  organisationId: string;
  formId: string;
  formVersionId: string;
  eventId: string | null;
  reference: string;
  status: 'partial' | 'complete';
  locale: string;
  email: string | null;
  data: Record<string, unknown>;
  resumeTokenHash: string | null;
  resumeExpiresAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmissionDraftInput {
  /** Present when resuming an existing draft rather than starting one. */
  id?: string;
  organisationId: string;
  formId: string;
  formVersionId: string;
  eventId: string | null;
  reference: string;
  locale: string;
  data: Record<string, unknown>;
  resumeTokenHash: string;
  resumeExpiresAt: Date;
}

export interface SubmissionCompleteInput {
  id?: string;
  organisationId: string;
  formId: string;
  formVersionId: string;
  eventId: string | null;
  reference: string;
  locale: string;
  email: string | null;
  data: Record<string, unknown>;
  /** Null means uncapped. Checked inside the same transaction as the insert. */
  capacity: number | null;
  duplicateControl: 'email' | 'none';
}

export type SubmissionCompleteResult =
  { ok: true; submission: SubmissionRecord } | { ok: false; reason: 'duplicate' | 'full' };

export interface SubmissionRepository {
  list(organisationId: string, formId: string): Promise<SubmissionRecord[]>;
  findByResumeTokenHash(tokenHash: string): Promise<SubmissionRecord | null>;
  countComplete(formId: string): Promise<number>;
  /** Save-and-resume. Creates the draft on first save and overwrites it thereafter. */
  saveDraft(input: SubmissionDraftInput): Promise<SubmissionRecord>;
  /**
   * The only way a submission becomes complete.
   *
   * Capacity and duplicate control are re-checked **inside** the write, not before it: checking
   * first and inserting afterwards lets two people pass the same last-place check.
   */
  complete(input: SubmissionCompleteInput): Promise<SubmissionCompleteResult>;
}

export interface JobRecord {
  id: string;
  organisationId: string;
  kind: string;
  idempotencyKey: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  progressDone: number;
  progressTotal: number;
  runAfter: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface JobRepository {
  /** Idempotent: the same key twice returns the existing job rather than duplicating the work. */
  enqueue(input: {
    organisationId: string;
    kind: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    progressTotal: number;
    maxAttempts?: number;
  }): Promise<JobRecord>;
  findById(organisationId: string, id: string): Promise<JobRecord | null>;
  /**
   * Takes one runnable job and marks it running in the same write, so two workers cannot both
   * claim it.
   */
  claim(now: Date): Promise<JobRecord | null>;
  progress(id: string, done: number): Promise<void>;
  succeed(id: string, result: Record<string, unknown>): Promise<void>;
  /** Re-queues with backoff while attempts remain, and fails permanently once they run out. */
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
}

export interface AuditRepository {
  record(entry: AuditEntryInput): Promise<void>;
  list(organisationId: string): Promise<AuditEntryRecord[]>;
}

export interface Repositories {
  organisations: OrganisationRepository;
  users: UserRepository;
  tokens: TokenRepository;
  events: EventRepository;
  forms: FormRepository;
  submissions: SubmissionRepository;
  jobs: JobRepository;
  audit: AuditRepository;
}
