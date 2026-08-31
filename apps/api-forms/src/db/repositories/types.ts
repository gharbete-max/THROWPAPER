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

export interface AuditRepository {
  record(entry: AuditEntryInput): Promise<void>;
  list(organisationId: string): Promise<AuditEntryRecord[]>;
}

export interface Repositories {
  organisations: OrganisationRepository;
  users: UserRepository;
  tokens: TokenRepository;
  events: EventRepository;
  audit: AuditRepository;
}
