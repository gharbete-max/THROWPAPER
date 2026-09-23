import { describe, expect, it } from 'vitest';
import {
  Evidence,
  apply,
  documentSha256,
  draftEnvelope,
  maxLevelFor,
  replay,
  whoMaySign,
  type Envelope,
  type EnvelopeEvent,
} from './index.js';

const HASH = 'a'.repeat(64);
const at = (minute: number) => new Date(Date.UTC(2026, 8, 23, 10, minute)).toISOString();

const envelope = (routing: Envelope['routing'], orders = [1, 2]): Envelope =>
  draftEnvelope({
    id: 'env-1',
    documentName: 'Lease',
    documentSha256: HASH,
    routing,
    environment: 'test',
    expiresAt: at(50),
    parties: orders.map((order, index) => ({
      id: `p${index + 1}`,
      name: `Party ${index + 1}`,
      locale: 'sv-SE',
      order,
    })),
  });

const evidence = (overrides: Partial<Evidence> = {}): Evidence =>
  Evidence.parse({
    method: 'drawn',
    level: 'simple',
    environment: 'test',
    signedAt: at(10),
    documentSha256: HASH,
    declaration: { key: 'lease.agree', version: 1, text: '[declaration authored by the owner]' },
    ...overrides,
  });

const signed = (partyId: string, minute: number, extra: Partial<Evidence> = {}): EnvelopeEvent => ({
  type: 'signed',
  at: at(minute),
  partyId,
  evidence: evidence(extra),
});

describe('a signature never claims more than it achieves', () => {
  it('caps a drawn mark at simple and an eID at advanced; nothing reaches qualified', () => {
    expect(maxLevelFor('drawn')).toBe('simple');
    expect(maxLevelFor('typed')).toBe('simple');
    expect(maxLevelFor('eid:bankid-se')).toBe('advanced');
  });

  it('refuses evidence that claims a higher level than its method', () => {
    expect(() => evidence({ level: 'advanced' })).toThrow(/claims more/);
    expect(() => evidence({ method: 'eid:mitid', level: 'qualified' })).toThrow(/claims more/);
    expect(evidence({ method: 'eid:mitid', level: 'advanced' }).level).toBe('advanced');
  });

  it('never lets the console provider produce a production signature', () => {
    expect(() => evidence({ method: 'console', environment: 'production' })).toThrow(/test mode/);
  });
});

describe('a sequential round', () => {
  it('invites one step at a time, and completes when the last party signs', () => {
    const result = replay(envelope('sequential'), [
      { type: 'sent', at: at(1) },
      signed('p1', 2),
      signed('p2', 3),
    ]);
    expect(result).toMatchObject({ ok: true, envelope: { status: 'completed' } });
  });

  it('refuses a signature out of turn', () => {
    const sent = replay(envelope('sequential'), [{ type: 'sent', at: at(1) }]);
    if (!sent.ok) throw new Error('setup');
    expect(whoMaySign(sent.envelope)).toEqual(['p1']);
    expect(apply(sent.envelope, signed('p2', 2))).toEqual({ ok: false, reason: 'not-their-turn' });
  });

  it('lets parties who share a step sign side by side', () => {
    const sent = replay(envelope('sequential', [1, 1, 2]), [{ type: 'sent', at: at(1) }]);
    if (!sent.ok) throw new Error('setup');
    expect(whoMaySign(sent.envelope).sort()).toEqual(['p1', 'p2']);
  });
});

describe('a parallel round', () => {
  it('invites everybody at once', () => {
    const sent = replay(envelope('parallel'), [{ type: 'sent', at: at(1) }]);
    if (!sent.ok) throw new Error('setup');
    expect(whoMaySign(sent.envelope).sort()).toEqual(['p1', 'p2']);
  });
});

describe('what ends a round, and what cannot happen after', () => {
  it('ends on one refusal: a half-signed document is not a signed document', () => {
    const result = replay(envelope('parallel'), [
      { type: 'sent', at: at(1) },
      signed('p1', 2),
      { type: 'declined', at: at(3), partyId: 'p2' },
    ]);
    expect(result).toMatchObject({ ok: true, envelope: { status: 'declined' } });
  });

  it('refuses a signature after the deadline, however close', () => {
    const result = replay(envelope('parallel'), [{ type: 'sent', at: at(1) }, signed('p1', 50)]);
    expect(result).toEqual({ ok: false, reason: 'past-expiry', index: 1 });
  });

  it('expires only once the deadline has passed', () => {
    const sent = replay(envelope('parallel'), [{ type: 'sent', at: at(1) }]);
    if (!sent.ok) throw new Error('setup');
    expect(apply(sent.envelope, { type: 'expired', at: at(49) })).toEqual({
      ok: false,
      reason: 'not-yet-expired',
    });
    expect(apply(sent.envelope, { type: 'expired', at: at(50) })).toMatchObject({
      ok: true,
      envelope: { status: 'expired' },
    });
  });

  it('changes nothing once finished: a signed document is immutable', () => {
    const done = replay(envelope('parallel', [1]), [{ type: 'sent', at: at(1) }, signed('p1', 2)]);
    if (!done.ok) throw new Error('setup');
    for (const event of [
      { type: 'cancelled', at: at(3) },
      { type: 'declined', at: at(3), partyId: 'p1' },
      signed('p1', 3),
    ] as EnvelopeEvent[]) {
      expect(apply(done.envelope, event)).toEqual({ ok: false, reason: 'finished' });
    }
  });

  it('refuses the same party signing twice', () => {
    const result = replay(envelope('parallel'), [
      { type: 'sent', at: at(1) },
      signed('p1', 2),
      signed('p1', 3),
    ]);
    expect(result).toEqual({ ok: false, reason: 'already-acted', index: 2 });
  });
});

describe('a signature is bound to one document and one environment', () => {
  it('refuses evidence over a different hash', () => {
    const result = replay(envelope('parallel'), [
      { type: 'sent', at: at(1) },
      signed('p1', 2, { documentSha256: 'b'.repeat(64) }),
    ]);
    expect(result).toEqual({ ok: false, reason: 'wrong-document', index: 1 });
  });

  it('refuses a production signature on a test envelope', () => {
    const result = replay(envelope('parallel'), [
      { type: 'sent', at: at(1) },
      signed('p1', 2, { method: 'eid:bankid-se', environment: 'production' }),
    ]);
    expect(result).toEqual({ ok: false, reason: 'wrong-environment', index: 1 });
  });
});

describe('documentSha256', () => {
  it('matches the published SHA-256 of "abc"', async () => {
    expect(await documentSha256(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('draftEnvelope', () => {
  it('refuses two parties with one id', () => {
    expect(() => envelope('parallel', [1, 1]).parties).not.toThrow();
    expect(() =>
      draftEnvelope({
        ...envelope('parallel'),
        parties: [
          { id: 'x', name: 'A', locale: 'sv-SE', order: 1 },
          { id: 'x', name: 'B', locale: 'sv-SE', order: 1 },
        ],
      }),
    ).toThrow(/share an id/);
  });
});
