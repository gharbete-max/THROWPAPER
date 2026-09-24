import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PHONE_SCAN_MAX_PAGES } from '@tp/shared/forms';

/**
 * Sessions for scanning with a phone, held in memory and nowhere else.
 *
 * A session lives fifteen minutes and holds at most twenty pages; the computer that opened it
 * collects them and closes it. Nothing is written to disk or the database: a photographed page
 * becomes something only when the person uses it (a document for signing, a form from paper), and
 * that path already stores what it keeps. A restart loses an unfinished scan, which is the right
 * failure for a thing that takes a minute to redo.
 *
 * The phone holds a 256-bit token in its link and nothing else; the store keeps only the token's
 * hash, so a heap dump names no usable link.
 */
export const PHONE_SCAN_TTL_MS = 15 * 60 * 1000;
/** Per person: opening a fourth closes the oldest. */
const MAX_OPEN_PER_USER = 3;

export interface PhoneScanPage {
  contentType: 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
}

export interface PhoneScanSessionRecord {
  id: string;
  organisationId: string;
  userId: string;
  expiresAt: Date;
  pages: PhoneScanPage[];
}

export interface PhoneScanStore {
  open(owner: { organisationId: string; userId: string }): {
    session: PhoneScanSessionRecord;
    token: string;
  };
  /** The computer's view: only the person who opened it. */
  find(
    id: string,
    owner: { organisationId: string; userId: string },
  ): PhoneScanSessionRecord | null;
  /** The phone's view: whoever holds the link. */
  byToken(token: string): PhoneScanSessionRecord | null;
  /** False when the session is full. */
  add(session: PhoneScanSessionRecord, page: PhoneScanPage): boolean;
  close(id: string): void;
  /** Live sessions, so the desktop's LAN relay can stop when there are none. */
  active(): number;
}

export function createPhoneScanStore(now: () => number = Date.now): PhoneScanStore {
  const sessions = new Map<string, PhoneScanSessionRecord & { tokenHash: string }>();
  const byHash = new Map<string, string>();

  function hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  function sweep() {
    for (const [id, session] of sessions) {
      if (session.expiresAt.getTime() <= now()) remove(id);
    }
  }

  function remove(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    byHash.delete(session.tokenHash);
    sessions.delete(id);
  }

  return {
    open(owner) {
      sweep();
      const mine = [...sessions.values()]
        .filter((s) => s.userId === owner.userId && s.organisationId === owner.organisationId)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      for (const old of mine.slice(0, Math.max(0, mine.length - MAX_OPEN_PER_USER + 1))) {
        remove(old.id);
      }
      const token = randomBytes(32).toString('base64url');
      const session = {
        id: randomUUID(),
        organisationId: owner.organisationId,
        userId: owner.userId,
        expiresAt: new Date(now() + PHONE_SCAN_TTL_MS),
        pages: [],
        tokenHash: hash(token),
      };
      sessions.set(session.id, session);
      byHash.set(session.tokenHash, session.id);
      return { session, token };
    },
    find(id, owner) {
      sweep();
      const session = sessions.get(id);
      return session &&
        session.organisationId === owner.organisationId &&
        session.userId === owner.userId
        ? session
        : null;
    },
    byToken(token) {
      sweep();
      const id = byHash.get(hash(token));
      return (id && sessions.get(id)) || null;
    },
    add(session, page) {
      if (session.pages.length >= PHONE_SCAN_MAX_PAGES) return false;
      session.pages.push(page);
      return true;
    },
    close(id) {
      remove(id);
    },
    active() {
      sweep();
      return sessions.size;
    },
  };
}

/** A JPEG or PNG by its first bytes, not by what the sender claims. */
export function imageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  return null;
}
