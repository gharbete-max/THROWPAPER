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
  /** Everybody in the organisation, for the administrator's user list. Ordered by name. */
  list(organisationId: string): Promise<UserRecord[]>;
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
  /** Null means the organisation's rather than any one person's — see packages/shared access.ts. */
  ownerUserId: string | null;
  /** In the bin since. Distinct from `status: archived`, which means retired but kept. */
  deletedAt: Date | null;
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
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'publishedVersionId'
  | 'publishedVersion'
  | 'status'
  | 'ownerUserId'
  | 'deletedAt'
> & {
  status?: FormRecord['status'];
  /** Omitted means the organisation's. A form cannot be created already in the bin, so there is
   * no way to say `deletedAt` here. */
  ownerUserId?: string | null;
};

export type FormUpdate = Partial<Omit<FormRecord, 'id' | 'organisationId' | 'createdAt'>>;

/**
 * Whose forms, and which pile.
 *
 * `userId` absent means the whole organisation, which only an administrator ever asks for. The
 * repository does not know about roles — the route decides who may omit it.
 */
export interface FormListFilter {
  userId?: string;
  /**
   * - `active` — everything the user can work on: owned, shared with them, and unowned. No bin.
   * - `mine` — owned by the user.
   * - `shared` — shared with the user by somebody else.
   * - `trash` — in the bin.
   * - `all` — every form in the organisation, bin excluded.
   */
  scope?: FormScope;
}

export type FormScope = 'active' | 'mine' | 'shared' | 'trash' | 'all';

export interface FormShareRecord {
  id: string;
  organisationId: string;
  formId: string;
  userId: string;
  role: 'viewer' | 'editor';
  createdAt: Date;
}

export interface FormRepository {
  /**
   * Forms, filtered.
   *
   * **Trashed forms are excluded from every scope but `trash`.** That is the whole safety property
   * of a bin: something deleted stops appearing where it used to, or the delete did nothing.
   */
  list(organisationId: string, filter?: FormListFilter): Promise<FormRecord[]>;
  findById(organisationId: string, id: string): Promise<FormRecord | null>;
  findBySlug(organisationId: string, slug: string): Promise<FormRecord | null>;
  create(input: FormCreate): Promise<FormRecord>;
  update(organisationId: string, id: string, patch: FormUpdate): Promise<FormRecord | null>;
  /**
   * Destroy a form and everything under it. Only ever reached from the bin, never from a list.
   *
   * Separate from `update({ deletedAt })` on purpose: one is reversible and one is not, and a
   * caller that confuses them should have to have typed a different word.
   */
  purge(organisationId: string, id: string): Promise<boolean>;

  listShares(organisationId: string, formId: string): Promise<FormShareRecord[]>;
  /** Sharing with the same person twice changes their role rather than adding a second row. */
  share(input: Omit<FormShareRecord, 'id' | 'createdAt'>): Promise<FormShareRecord>;
  unshare(organisationId: string, formId: string, userId: string): Promise<boolean>;
  /**
   * Every share addressed to one person, so a list of forms can be labelled with one query
   * instead of one per row.
   */
  sharesForUser(organisationId: string, userId: string): Promise<FormShareRecord[]>;
  /** Share counts for many forms at once, keyed by form id. Absent means none. */
  shareCounts(organisationId: string, formIds: readonly string[]): Promise<Record<string, number>>;

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
  /**
   * The newest responses across several forms, for the cross-form inbox.
   *
   * Capped by `limit` in the query rather than trimmed afterwards: an inbox over twenty forms with
   * five hundred responses each would otherwise read ten thousand rows to show fifty.
   */
  listForForms(
    organisationId: string,
    formIds: readonly string[],
    limit: number,
  ): Promise<SubmissionRecord[]>;
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

export interface LedgerAccountRecord {
  id: string;
  organisationId: string;
  code: string;
  name: Record<string, string>;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  archivedAt: Date | null;
  createdAt: Date;
}

export interface JournalLineRecord {
  id: string;
  entryId: string;
  accountId: string;
  debitMinor: bigint;
  creditMinor: bigint;
  memo: string | null;
  position: number;
}

export interface JournalEntryRecord {
  id: string;
  organisationId: string;
  reference: string;
  description: string;
  /** The date the thing happened — `YYYY-MM-DD`, not a timestamp. See the schema for why. */
  occurredOn: string;
  postedAt: Date;
  postedByUserId: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  currency: string;
}

export interface JournalEntryWithLines extends JournalEntryRecord {
  lines: JournalLineRecord[];
}

/**
 * The ledger.
 *
 * **There is no `update` and no `delete` here, and there never will be.** A posted entry is
 * corrected by posting a reversing one; both stay in the book for ever. That is not a policy this
 * interface enforces — it is a capability it does not offer, which is a much harder thing to work
 * around by accident.
 *
 * `post` is the only way a row is written, and it writes the entry and its lines in one
 * transaction: a half-written entry would make the whole book fail its trial balance, and there is
 * no repair path because there is no update.
 */
export interface LedgerRepository {
  listAccounts(organisationId: string): Promise<LedgerAccountRecord[]>;
  findAccount(organisationId: string, id: string): Promise<LedgerAccountRecord | null>;
  createAccount(input: {
    organisationId: string;
    code: string;
    name: Record<string, string>;
    type: LedgerAccountRecord['type'];
  }): Promise<LedgerAccountRecord>;
  /** Retiring an account is the only thing "removing" one can honestly mean once it has entries. */
  archiveAccount(
    organisationId: string,
    id: string,
    at: Date | null,
  ): Promise<LedgerAccountRecord | null>;

  listEntries(organisationId: string, limit: number): Promise<JournalEntryWithLines[]>;
  findEntry(organisationId: string, id: string): Promise<JournalEntryWithLines | null>;

  /**
   * Write an entry and its lines, atomically.
   *
   * `reverses` links a reversal to what it undoes and stamps the original in the same
   * transaction, so "has this been reversed" can never disagree with the reversal's own existence.
   */
  post(input: {
    organisationId: string;
    reference: string;
    description: string;
    occurredOn: string;
    postedByUserId: string | null;
    currency: string;
    reversesEntryId?: string | null;
    lines: Array<{
      accountId: string;
      debitMinor: bigint;
      creditMinor: bigint;
      memo: string | null;
    }>;
  }): Promise<JournalEntryWithLines>;

  /** The next reference for this organisation. Derived, never supplied — see `forms.createVersion`. */
  nextReference(organisationId: string): Promise<string>;

  /** Every line in the book, for the trial balance and the account totals. */
  allLines(organisationId: string): Promise<JournalLineRecord[]>;
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
  ledger: LedgerRepository;
  invoices: InvoiceRepository;
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

/** One line as it was billed. Stored, never recomputed — see the schema for why. */
export interface InvoiceLineRecord {
  id: string;
  description: Record<string, string>;
  quantityThousandths: bigint;
  unitAmountMinor: bigint;
  amountMinor: bigint;
  vatRateBasisPoints: number;
  vatMinor: bigint;
  position: number;
}

export interface InvoiceRecord {
  id: string;
  organisationId: string;
  batchId: string | null;
  number: number;
  ocr: string;
  status: 'draft' | 'issued' | 'sent' | 'paid' | 'cancelled';
  currency: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientAddress: string | null;
  recipientReference: string | null;
  subject: Record<string, string>;
  periodStart: string | null;
  periodEnd: string | null;
  issuedOn: string;
  dueOn: string;
  netMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  paymentMethod: string;
  paymentAccount: string;
  publicToken: string;
  sentAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  lines: InvoiceLineRecord[];
}

export interface InvoiceBatchRecord {
  id: string;
  organisationId: string;
  name: string;
  createdBy: string | null;
  sentAt: Date | null;
  lastTestAt: Date | null;
  createdAt: Date;
}

export interface InvoiceRepository {
  listBatches(organisationId: string): Promise<InvoiceBatchRecord[]>;
  findBatch(organisationId: string, id: string): Promise<InvoiceBatchRecord | null>;

  /**
   * Create a run and every invoice in it, atomically.
   *
   * One call rather than a batch row followed by forty inserts, because a run that half exists is
   * worse than one that does not: the numbers are already allocated, the references are already
   * issued, and nobody can tell which tenants were billed.
   *
   * The **numbers are allocated here**, inside the transaction, and the reference is built from
   * them. That is the only place uniqueness can be promised — `ocr.ts` makes a well-formed
   * reference and cannot know whether it has been used before.
   */
  createBatch(input: {
    organisationId: string;
    name: string;
    createdBy: string | null;
    invoices: Array<{
      recipientName: string;
      recipientEmail: string | null;
      recipientAddress: string | null;
      recipientReference: string | null;
      subject: Record<string, string>;
      currency: string;
      periodStart: string | null;
      periodEnd: string | null;
      issuedOn: string;
      dueOn: string;
      paymentMethod: string;
      paymentAccount: string;
      ocrLengthControl: boolean;
      lines: Array<{
        description: Record<string, string>;
        quantityThousandths: bigint;
        unitAmountMinor: bigint;
        amountMinor: bigint;
        vatRateBasisPoints: number;
        vatMinor: bigint;
      }>;
    }>;
  }): Promise<{ batch: InvoiceBatchRecord; invoices: InvoiceRecord[] }>;

  listInvoices(organisationId: string, batchId?: string): Promise<InvoiceRecord[]>;
  findInvoice(organisationId: string, id: string): Promise<InvoiceRecord | null>;

  /**
   * The public lookup, by token alone.
   *
   * No organisation: the person opening the link is a tenant, not a user, and has no session to
   * scope by. The token is what stands in for one, which is why it is long, random, and not the
   * payment reference.
   */
  findByPublicToken(token: string): Promise<InvoiceRecord | null>;

  markSent(organisationId: string, batchId: string, at: Date): Promise<void>;
  markTested(organisationId: string, batchId: string, at: Date): Promise<void>;
}
