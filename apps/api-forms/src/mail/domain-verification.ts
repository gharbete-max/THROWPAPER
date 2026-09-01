import { Resolver } from 'node:dns/promises';

/**
 * Sending-domain verification — `SPEC-mailer.md` §6: "Guided sending-domain setup: SPF, DKIM and
 * DMARC with live check status. **Refuse to send from an unverified domain — no override.**"
 *
 * That last clause is the one rule in this phase with no escape hatch, and `assertSendable` is
 * where it is enforced. Everything else here is diagnosis: telling an operator exactly which
 * record is missing and what to paste, because START-HERE's phase 4 checkpoint says that when
 * mail does not arrive the problem is configuration, not code.
 */
export type RecordState = 'pass' | 'missing' | 'misconfigured';

export interface RecordCheck {
  record: 'spf' | 'dkim' | 'dmarc';
  state: RecordState;
  /** What was actually found, for showing next to what was expected. */
  found: string | null;
  detail: string;
}

export interface DomainVerification {
  domain: string;
  verified: boolean;
  checks: RecordCheck[];
  checkedAt: string;
}

/** Just enough of a resolver to stub in tests. */
export interface TxtResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
}

export function systemResolver(): TxtResolver {
  return new Resolver();
}

export interface VerifyOptions {
  domain: string;
  /** The DKIM selector the provider issued. SES gives three; any one verifying is enough here. */
  dkimSelectors: readonly string[];
  /** SES sends via amazonses.com, so that is what SPF has to authorise. */
  spfInclude?: string;
  resolver?: TxtResolver;
  now?: () => Date;
}

export async function verifyDomain(options: VerifyOptions): Promise<DomainVerification> {
  const resolver = options.resolver ?? systemResolver();
  const now = options.now ?? (() => new Date());
  const spfInclude = options.spfInclude ?? 'amazonses.com';

  const checks: RecordCheck[] = [
    await checkSpf(resolver, options.domain, spfInclude),
    await checkDkim(resolver, options.domain, options.dkimSelectors),
    await checkDmarc(resolver, options.domain),
  ];

  return {
    domain: options.domain,
    // All three. A domain passing SPF alone is exactly the setup that lands in spam.
    verified: checks.every((check) => check.state === 'pass'),
    checks,
    checkedAt: now().toISOString(),
  };
}

async function checkSpf(
  resolver: TxtResolver,
  domain: string,
  include: string,
): Promise<RecordCheck> {
  const records = await txt(resolver, domain);
  const spf = records.find((record) => record.toLowerCase().startsWith('v=spf1'));

  if (!spf) {
    return {
      record: 'spf',
      state: 'missing',
      found: null,
      detail: `Add a TXT record at ${domain}: "v=spf1 include:${include} ~all"`,
    };
  }
  if (!spf.toLowerCase().includes(`include:${include}`)) {
    return {
      record: 'spf',
      state: 'misconfigured',
      found: spf,
      detail: `The SPF record does not authorise ${include}. Add "include:${include}" before the all mechanism.`,
    };
  }
  // More than one SPF record is a hard failure at the receiver, not a warning.
  if (records.filter((record) => record.toLowerCase().startsWith('v=spf1')).length > 1) {
    return {
      record: 'spf',
      state: 'misconfigured',
      found: spf,
      detail:
        'There is more than one SPF record. Receivers treat that as a permanent error — merge them into one.',
    };
  }
  return { record: 'spf', state: 'pass', found: spf, detail: 'SPF authorises the sender.' };
}

async function checkDkim(
  resolver: TxtResolver,
  domain: string,
  selectors: readonly string[],
): Promise<RecordCheck> {
  if (selectors.length === 0) {
    return {
      record: 'dkim',
      state: 'missing',
      found: null,
      detail: 'No DKIM selector is configured for this domain yet.',
    };
  }

  for (const selector of selectors) {
    const records = await txt(resolver, `${selector}._domainkey.${domain}`);
    const dkim = records.find((record) => record.toLowerCase().includes('p='));
    if (dkim) {
      return {
        record: 'dkim',
        state: 'pass',
        found: dkim,
        detail: `DKIM verified via ${selector}.`,
      };
    }
  }

  return {
    record: 'dkim',
    state: 'missing',
    found: null,
    detail: `No DKIM key found. Publish the CNAME or TXT records for: ${selectors.join(', ')}`,
  };
}

async function checkDmarc(resolver: TxtResolver, domain: string): Promise<RecordCheck> {
  const records = await txt(resolver, `_dmarc.${domain}`);
  const dmarc = records.find((record) => record.toLowerCase().startsWith('v=dmarc1'));

  if (!dmarc) {
    return {
      record: 'dmarc',
      state: 'missing',
      found: null,
      detail: `Add a TXT record at _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}"`,
    };
  }
  if (!/[;\s]p\s*=/i.test(dmarc)) {
    return {
      record: 'dmarc',
      state: 'misconfigured',
      found: dmarc,
      detail: 'The DMARC record has no policy (p=). Start with p=none while you watch the reports.',
    };
  }
  return { record: 'dmarc', state: 'pass', found: dmarc, detail: 'DMARC policy published.' };
}

/** A missing record and a DNS failure look the same from here: nothing to verify against. */
async function txt(resolver: TxtResolver, hostname: string): Promise<string[]> {
  try {
    return (await resolver.resolveTxt(hostname)).map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

export class UnverifiedDomainError extends Error {
  constructor(readonly domain: string) {
    super(
      `Refusing to send from ${domain}: the sending domain is not verified. ` +
        'SPF, DKIM and DMARC must all pass first — SPEC-mailer.md §6 allows no override.',
    );
    this.name = 'UnverifiedDomainError';
  }
}

/**
 * The gate. Called before every send that is not a development console send.
 *
 * There is deliberately no `force` parameter. Sending from an unverified domain is how a young
 * domain's reputation gets destroyed, and it is unrecoverable in a way that a blocked send is not.
 */
export function assertSendable(verification: DomainVerification | null, domain: string): void {
  if (!verification?.verified) throw new UnverifiedDomainError(domain);
}

export function domainOf(address: string): string {
  return address.split('@').pop()?.toLowerCase().trim() ?? '';
}
