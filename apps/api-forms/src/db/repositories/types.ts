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
  /**
   * People holding a place: completed, not withdrawn.
   *
   * This was stubbed to `0` while registrations were still being built, and stayed stubbed after
   * they arrived — so every event reported nobody registered and every event's registration
   * stayed "open" however full it was. Nothing showed the number, so nothing contradicted it.
   */
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
  revokedAt: Date | null;
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
  /**
   * One submission by id.
   *
   * Added because the only way to do this was to list every form in the organisation and then
   * every submission of every form, and scan. Twenty forms with five hundred responses each meant
   * ten thousand rows read to find one — per admission document generated.
   */
  findById(organisationId: string, submissionId: string): Promise<SubmissionRecord | null>;
  /**
   * Every submission for an event, across whichever forms feed it.
   *
   * The attendance and check-in screens want exactly this, and were assembling it by listing the
   * organisation's forms, filtering them in memory, and issuing one query per surviving form.
   */
  listForEvent(organisationId: string, eventId: string): Promise<SubmissionRecord[]>;
  findByResumeTokenHash(tokenHash: string): Promise<SubmissionRecord | null>;
  countComplete(formId: string): Promise<number>;
  /**
   * Completed counts for several forms at once, keyed by form id.
   *
   * The forms list needs a count per row; calling `countComplete` in a loop makes the list cost
   * one query per form. Forms with no completed responses are absent from the result rather than
   * present as nought, so the caller decides what missing means.
   */
  countCompleteByForm(
    organisationId: string,
    formIds: readonly string[],
  ): Promise<Record<string, number>>;
  /** Save-and-resume. Creates the draft on first save and overwrites it thereafter. */
  saveDraft(input: SubmissionDraftInput): Promise<SubmissionRecord>;
  findByReference(organisationId: string, reference: string): Promise<SubmissionRecord | null>;
  /** Withdraws a registration without deleting it. */
  revoke(organisationId: string, id: string, at: Date): Promise<SubmissionRecord | null>;
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

export interface SendingDomainRecord {
  id: string;
  organisationId: string;
  domain: string;
  fromAddress: string;
  dkimSelectors: string[];
  verified: boolean;
  checks: unknown[];
  lastCheckedAt: Date | null;
  createdAt: Date;
}

export interface SendingDomainRepository {
  list(organisationId: string): Promise<SendingDomainRecord[]>;
  findById(organisationId: string, id: string): Promise<SendingDomainRecord | null>;
  findByDomain(organisationId: string, domain: string): Promise<SendingDomainRecord | null>;
  create(input: {
    organisationId: string;
    domain: string;
    fromAddress: string;
    dkimSelectors: string[];
  }): Promise<SendingDomainRecord>;
  saveVerification(
    id: string,
    input: { verified: boolean; checks: unknown[]; lastCheckedAt: Date },
  ): Promise<SendingDomainRecord | null>;
}

export interface MessageRecord {
  id: string;
  organisationId: string;
  submissionId: string | null;
  templateKey: string;
  to: string;
  locale: string;
  subject: string;
  providerMessageId: string | null;
  provider: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface MessageRepository {
  list(organisationId: string): Promise<MessageRecord[]>;
  record(input: Omit<MessageRecord, 'id' | 'createdAt'>): Promise<MessageRecord>;
}

export interface CheckInRecord {
  id: string;
  organisationId: string;
  submissionId: string;
  eventId: string;
  checkedInAt: Date;
  checkedInByUserId: string | null;
  method: 'scan' | 'manual';
}

export interface CheckInRepository {
  listForEvent(organisationId: string, eventId: string): Promise<CheckInRecord[]>;
  findBySubmission(submissionId: string): Promise<CheckInRecord | null>;
  /**
   * Idempotent admit.
   *
   * Returns `created: false` with the original row when the attendee was already checked in — a
   * scanner retrying after a dropped response must not become an error at a door.
   */
  admit(input: {
    organisationId: string;
    submissionId: string;
    eventId: string;
    checkedInByUserId: string | null;
    method: 'scan' | 'manual';
  }): Promise<{ created: boolean; checkIn: CheckInRecord }>;
}

export interface BrandKitRecord {
  organisationId: string;
  /** A TokenSet. Kept opaque here so the repository layer does not depend on the token package. */
  tokens: Record<string, unknown>;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface BrandKitRepository {
  /** `null` means the organisation has not chosen one, and the shipped defaults apply. */
  find(organisationId: string): Promise<BrandKitRecord | null>;
  save(input: {
    organisationId: string;
    tokens: Record<string, unknown>;
    updatedBy: string | null;
  }): Promise<BrandKitRecord>;
  /** Back to the shipped defaults, by removing the row rather than storing a copy of them. */
  clear(organisationId: string): Promise<void>;
}

export interface AuditRepository {
  record(entry: AuditEntryInput): Promise<void>;
  list(organisationId: string): Promise<AuditEntryRecord[]>;
}

export interface Repositories {
  uploads: UploadRepository;
  organisations: OrganisationRepository;
  users: UserRepository;
  tokens: TokenRepository;
  events: EventRepository;
  forms: FormRepository;
  submissions: SubmissionRepository;
  checkIns: CheckInRepository;
  jobs: JobRepository;
  brandKits: BrandKitRepository;
  sendingDomains: SendingDomainRepository;
  messages: MessageRepository;
  audit: AuditRepository;
}

/** A file a respondent attached. The bytes live in the private upload store, keyed by `storageKey`. */
export interface UploadRecord {
  id: string;
  organisationId: string;
  formId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  bytes: number;
  submissionId: string | null;
  createdAt: Date;
}

export interface UploadCreate {
  organisationId: string;
  formId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  bytes: number;
}

export interface UploadRepository {
  create(input: UploadCreate): Promise<UploadRecord>;
  /**
   * Uploads for this form that nothing has claimed yet, among the given keys.
   *
   * This is the check that stops a key being pasted from somewhere else. A content address is
   * guessable by anybody who has the same file, so "the answer names a real upload" is not enough
   * on its own — it has to be an upload *this form* received and no submission has taken.
   */
  findUnclaimed(formId: string, storageKeys: readonly string[]): Promise<UploadRecord[]>;
  /** Attaches uploads to the submission that finally arrived, so they stop looking abandoned. */
  claim(ids: readonly string[], submissionId: string): Promise<void>;
  /** Filenames for a page of submissions, so a grid can show names rather than hashes. */
  listForSubmissions(
    organisationId: string,
    submissionIds: readonly string[],
  ): Promise<UploadRecord[]>;
  /** The one row a download is allowed to read: this key, on a submission this organisation owns. */
  findForDownload(
    organisationId: string,
    submissionId: string,
    storageKey: string,
  ): Promise<UploadRecord | null>;
}
