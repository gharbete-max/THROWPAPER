import { Email } from '@tp/shared/api';

/**
 * Looking over a list of addresses before it is previewed: a pure check, no network. Three kinds
 * of finding, only the first of which stops anything:
 *
 * - `syntax`: not an address. It cannot be sent to, so it is fixed or skipped.
 * - `duplicate`: the same address again (any capitals). The send is keyed on the address, so it
 *   would go once either way; the later row is shown so the count is not a surprise.
 * - `typo`: a well-known mail domain written almost right (`gmial.com`). A suggestion only: it is
 *   never applied unasked, because the address may be exactly what the person meant.
 * - `role`: `info@`, `noreply@`: a mailbox rather than a person. Information, not a problem.
 */
export type AddressIssue =
  | { kind: 'syntax'; index: number }
  | { kind: 'duplicate'; index: number; of: number }
  | { kind: 'typo'; index: number; suggestion: string }
  | { kind: 'role'; index: number };

/** Mail domains common enough that a near miss is most likely a slip. */
export const COMMON_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.se',
  'outlook.com',
  'outlook.se',
  'live.com',
  'live.se',
  'yahoo.com',
  'yahoo.se',
  'icloud.com',
  'me.com',
  'msn.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'telia.com',
  'comhem.se',
  'bredband.net',
] as const;

/** Mailboxes that belong to a function, not a person. */
export const ROLE_NAMES = [
  'info',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'admin',
  'support',
  'sales',
  'contact',
  'office',
  'kontakt',
  'post',
  'postmaster',
  'webmaster',
  'abuse',
] as const;

/** Shortest domain that gets a suggestion: a two-letter slip in `me.com` is not a pattern. */
const MIN_DOMAIN = 7;

/** Edit distance counting a swap of neighbours as one, so `gmial` is one away from `gmail`. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/** The common domain this one is one slip away from, or `null` (also for a common domain itself). */
export function suggestDomain(domain: string): string | null {
  const wanted = domain.trim().toLowerCase();
  if (wanted.length < MIN_DOMAIN) return null;
  if ((COMMON_DOMAINS as readonly string[]).includes(wanted)) return null;
  return COMMON_DOMAINS.find((known) => editDistance(wanted, known) === 1) ?? null;
}

const split = (address: string): { local: string; domain: string } => {
  const at = address.lastIndexOf('@');
  return { local: address.slice(0, at), domain: address.slice(at + 1) };
};

/**
 * Every finding in a list, in list order. `null` marks a row already skipped: it is ignored, and
 * its address does not make a later one a duplicate. `duplicates` is off for a list where the
 * same person legitimately appears twice (two invoices to one tenant).
 */
export function checkAddresses(
  addresses: readonly (string | null)[],
  options: { duplicates: boolean } = { duplicates: true },
): AddressIssue[] {
  const issues: AddressIssue[] = [];
  const first = new Map<string, number>();
  addresses.forEach((raw, index) => {
    if (raw === null) return;
    const address = raw.trim().toLowerCase();
    if (!Email.safeParse(address).success) {
      issues.push({ kind: 'syntax', index });
      return;
    }
    const earlier = first.get(address);
    if (earlier === undefined) first.set(address, index);
    else if (options.duplicates) issues.push({ kind: 'duplicate', index, of: earlier });
    const { local, domain } = split(address);
    const suggestion = suggestDomain(domain);
    if (suggestion) issues.push({ kind: 'typo', index, suggestion: `${local}@${suggestion}` });
    if ((ROLE_NAMES as readonly string[]).includes(local.split('+')[0]!)) {
      issues.push({ kind: 'role', index });
    }
  });
  return issues;
}

/** Whether a finding stops the list from going on until it is fixed or skipped. */
export const blocks = (issue: AddressIssue): boolean => issue.kind === 'syntax';

/** The pieces of what a person typed or pasted, in order and not merged: duplicates stay visible. */
export function tokensOf(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
