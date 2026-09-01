import { describe, expect, it } from 'vitest';
import {
  UnverifiedDomainError,
  assertSendable,
  domainOf,
  verifyDomain,
  type TxtResolver,
} from './domain-verification.js';

/** A resolver backed by a map, so nothing here touches real DNS. */
function resolverFor(records: Record<string, string[]>): TxtResolver {
  return {
    async resolveTxt(hostname) {
      const found = records[hostname];
      if (!found) throw new Error('ENOTFOUND');
      return found.map((record) => [record]);
    },
  };
}

const DOMAIN = 'demo.se';

const healthy = {
  'demo.se': ['v=spf1 include:amazonses.com ~all'],
  'sel1._domainkey.demo.se': ['v=DKIM1; k=rsa; p=MIGfMA0GCS'],
  '_dmarc.demo.se': ['v=DMARC1; p=none; rua=mailto:dmarc@demo.se'],
};

function verify(records: Record<string, string[]>) {
  return verifyDomain({
    domain: DOMAIN,
    dkimSelectors: ['sel1'],
    resolver: resolverFor(records),
  });
}

describe('a healthy domain', () => {
  it('passes all three checks', async () => {
    const result = await verify(healthy);
    expect(result.verified).toBe(true);
    expect(result.checks.map((check) => check.state)).toEqual(['pass', 'pass', 'pass']);
  });
});

describe('SPF', () => {
  it('is missing when there is no record', async () => {
    const result = await verify({ ...healthy, 'demo.se': [] });
    const spf = result.checks.find((check) => check.record === 'spf');
    expect(spf?.state).toBe('missing');
    // The detail has to be pasteable — the operator fixes this in DNS, not in the app.
    expect(spf?.detail).toContain('include:amazonses.com');
    expect(result.verified).toBe(false);
  });

  it('is misconfigured when it does not authorise the provider', async () => {
    const result = await verify({ ...healthy, 'demo.se': ['v=spf1 include:someoneelse.com ~all'] });
    expect(result.checks.find((check) => check.record === 'spf')?.state).toBe('misconfigured');
  });

  it('flags two SPF records — receivers treat that as a permanent error', async () => {
    const result = await verify({
      ...healthy,
      'demo.se': ['v=spf1 include:amazonses.com ~all', 'v=spf1 include:other.com ~all'],
    });
    const spf = result.checks.find((check) => check.record === 'spf');
    expect(spf?.state).toBe('misconfigured');
    expect(spf?.detail).toContain('more than one SPF record');
  });
});

describe('DKIM', () => {
  it('is missing when no selector resolves', async () => {
    const records = { ...healthy };
    delete (records as Record<string, string[]>)['sel1._domainkey.demo.se'];
    const result = await verify(records);
    expect(result.checks.find((check) => check.record === 'dkim')?.state).toBe('missing');
  });

  it('passes when any one of several selectors resolves', async () => {
    const result = await verifyDomain({
      domain: DOMAIN,
      dkimSelectors: ['nope', 'sel1'],
      resolver: resolverFor(healthy),
    });
    expect(result.checks.find((check) => check.record === 'dkim')?.state).toBe('pass');
  });
});

describe('DMARC', () => {
  it('is missing when there is no record', async () => {
    const records = { ...healthy };
    delete (records as Record<string, string[]>)['_dmarc.demo.se'];
    const result = await verify(records);
    expect(result.checks.find((check) => check.record === 'dmarc')?.state).toBe('missing');
  });

  it('is misconfigured without a policy', async () => {
    const result = await verify({
      ...healthy,
      '_dmarc.demo.se': ['v=DMARC1; rua=mailto:x@demo.se'],
    });
    expect(result.checks.find((check) => check.record === 'dmarc')?.state).toBe('misconfigured');
  });
});

describe('partial configuration', () => {
  it('is not verified with SPF alone — that is exactly the setup that lands in spam', async () => {
    const result = await verify({ 'demo.se': ['v=spf1 include:amazonses.com ~all'] });
    expect(result.checks.find((check) => check.record === 'spf')?.state).toBe('pass');
    expect(result.verified).toBe(false);
  });
});

describe('the rule with no override', () => {
  it('refuses to send from an unverified domain', () => {
    expect(() => assertSendable(null, DOMAIN)).toThrow(UnverifiedDomainError);
    expect(() =>
      assertSendable({ domain: DOMAIN, verified: false, checks: [], checkedAt: '' }, DOMAIN),
    ).toThrow(/no override/);
  });

  it('allows a verified domain', () => {
    expect(() =>
      assertSendable({ domain: DOMAIN, verified: true, checks: [], checkedAt: '' }, DOMAIN),
    ).not.toThrow();
  });

  it('has no force parameter — the signature is the guarantee', () => {
    // A one-argument escape hatch is how a young domain's reputation gets destroyed.
    expect(assertSendable.length).toBe(2);
  });
});

describe('domainOf', () => {
  it('takes the domain from an address, case-insensitively', () => {
    expect(domainOf('Anmalan@Demo.SE')).toBe('demo.se');
    expect(domainOf('not-an-address')).toBe('not-an-address');
  });
});
