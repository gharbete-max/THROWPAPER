import { z } from 'zod';
import { Evidence, FINAL_STATUSES, type Envelope, type PartyStatus } from './model.js';

/**
 * Everything that can happen to an envelope, as the audit trail records it.
 *
 * The trail is the source of truth: an envelope's state is whatever {@link replay} makes of its
 * events, so the state and its history cannot disagree. Every event carries the time it happened,
 * supplied by the caller — this package has no clock, which is what lets a test drive a whole
 * signing round, expiry included, without waiting for anything.
 */
export const EnvelopeEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sent'), at: z.string().datetime() }),
  z.object({ type: z.literal('viewed'), at: z.string().datetime(), partyId: z.string() }),
  z.object({
    type: z.literal('signed'),
    at: z.string().datetime(),
    partyId: z.string(),
    evidence: Evidence,
  }),
  z.object({ type: z.literal('declined'), at: z.string().datetime(), partyId: z.string() }),
  z.object({ type: z.literal('expired'), at: z.string().datetime() }),
  z.object({ type: z.literal('cancelled'), at: z.string().datetime() }),
]);
export type EnvelopeEvent = z.infer<typeof EnvelopeEvent>;

export type Refusal =
  | 'finished'
  | 'not-sent'
  | 'already-sent'
  | 'no-such-party'
  | 'not-their-turn'
  | 'already-acted'
  | 'past-expiry'
  | 'not-yet-expired'
  | 'wrong-document'
  | 'wrong-environment';

export type Applied = { ok: true; envelope: Envelope } | { ok: false; reason: Refusal };

/**
 * One event applied to one envelope, or the reason it cannot be.
 *
 * Refusals are values, not exceptions: a late click on an expired link is an ordinary thing to
 * happen and the caller has to say something sensible about it.
 */
export function apply(envelope: Envelope, event: EnvelopeEvent): Applied {
  if (FINAL_STATUSES.includes(envelope.status)) return refuse('finished');

  const late = Date.parse(event.at) >= Date.parse(envelope.expiresAt);

  switch (event.type) {
    case 'sent': {
      if (envelope.status !== 'draft') return refuse('already-sent');
      if (late) return refuse('past-expiry');
      return done(invite({ ...envelope, status: 'sent' }));
    }

    case 'cancelled':
      return done({ ...envelope, status: 'cancelled' });

    case 'expired': {
      if (envelope.status !== 'sent') return refuse('not-sent');
      if (!late) return refuse('not-yet-expired');
      return done({ ...envelope, status: 'expired' });
    }

    case 'viewed':
    case 'signed':
    case 'declined': {
      if (envelope.status !== 'sent') return refuse('not-sent');
      // Past the deadline only `expired` may happen: a signature at 00:01 on an envelope that
      // closed at midnight is not a signature, however fast the network was.
      if (late) return refuse('past-expiry');

      const current = envelope.partyStatus[event.partyId];
      if (current === undefined) return refuse('no-such-party');
      if (current === 'signed' || current === 'declined') return refuse('already-acted');
      if (current === 'waiting') return refuse('not-their-turn');

      if (event.type === 'viewed') {
        return done(withParty(envelope, event.partyId, 'viewed'));
      }

      if (event.type === 'declined') {
        // One refusal ends the round: a document half the parties signed is not a signed document.
        return done({ ...withParty(envelope, event.partyId, 'declined'), status: 'declined' });
      }

      if (event.evidence.documentSha256 !== envelope.documentSha256)
        return refuse('wrong-document');
      if (event.evidence.environment !== envelope.environment) return refuse('wrong-environment');

      const signed = {
        ...withParty(envelope, event.partyId, 'signed'),
        evidence: { ...envelope.evidence, [event.partyId]: event.evidence },
      };
      const everyone = signed.parties.every((party) => signed.partyStatus[party.id] === 'signed');
      return done(everyone ? { ...signed, status: 'completed' } : invite(signed));
    }
  }
}

/** The whole trail, in order. The first refusal stops it, and says which event it was. */
export function replay(
  draft: Envelope,
  events: readonly EnvelopeEvent[],
): { ok: true; envelope: Envelope } | { ok: false; reason: Refusal; index: number } {
  let envelope = draft;
  for (const [index, event] of events.entries()) {
    const result = apply(envelope, event);
    if (!result.ok) return { ...result, index };
    envelope = result.envelope;
  }
  return { ok: true, envelope };
}

/** Parties whose turn it is: invited or viewed, and not yet done. */
export function whoMaySign(envelope: Envelope): string[] {
  if (envelope.status !== 'sent') return [];
  return envelope.parties
    .filter((party) => {
      const status = envelope.partyStatus[party.id];
      return status === 'invited' || status === 'viewed';
    })
    .map((party) => party.id);
}

/**
 * Invites whoever's turn it now is.
 *
 * Parallel: everyone at once. Sequential: the lowest `order` still waiting, once nobody earlier
 * is outstanding — and parties sharing an order sign side by side within their step.
 */
function invite(envelope: Envelope): Envelope {
  const outstanding = envelope.parties.filter(
    (party) => envelope.partyStatus[party.id] !== 'signed',
  );
  if (outstanding.length === 0) return envelope;

  if (envelope.routing === 'parallel') {
    return outstanding.reduce(
      (next, party) =>
        next.partyStatus[party.id] === 'waiting' ? withParty(next, party.id, 'invited') : next,
      envelope,
    );
  }

  const step = Math.min(...outstanding.map((party) => party.order));
  return outstanding
    .filter((party) => party.order === step && envelope.partyStatus[party.id] === 'waiting')
    .reduce((next, party) => withParty(next, party.id, 'invited'), envelope);
}

function withParty(envelope: Envelope, partyId: string, status: PartyStatus): Envelope {
  return { ...envelope, partyStatus: { ...envelope.partyStatus, [partyId]: status } };
}

function done(envelope: Envelope): Applied {
  return { ok: true, envelope };
}

function refuse(reason: Refusal): Applied {
  return { ok: false, reason };
}
