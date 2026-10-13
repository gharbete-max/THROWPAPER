import {
  checkBankgiro,
  checkIban,
  checkPlusgiro,
  checkReference,
  parseAmount,
  parseDate,
  type Bank,
  type Candidate,
  type Check,
  type Flag,
  type InvoiceReading,
  type PaymentReference,
  type PayableFieldKey,
  type ReviewedPayable,
  type Where,
} from '@tp/shared/payable';

/**
 * The review of a reading (`docs/HANDOVER.md` decision 5): what the person has been shown, chosen,
 * typed and confirmed, and when that is enough to keep a record.
 *
 * Pure, no React and no server. Nothing here accepts a value for the person: a field is ready only
 * when it has a value, the person confirmed it, and — if its own check digit failed — the person
 * said, separately, to keep it anyway. Changing a field takes its confirmation back.
 */
export type Key = PayableFieldKey;
export const KEYS: readonly Key[] = ['total', 'currency', 'dueDate', 'bank', 'reference', 'vat'];
/** A record without these is not a payable. The rest may be left out, by a decision. */
export const REQUIRED: readonly Key[] = ['total', 'currency'];
export const CURRENCIES = ['SEK', 'NOK', 'DKK', 'EUR', 'USD', 'GBP', 'CHF'] as const;

export interface FieldState {
  /** Which candidate of the reading is in front of the person. */
  choice: number;
  /** What the person typed in its place, or null while the page's own reading stands. */
  typed: string | null;
  /** For a typed bank number: which kind. */
  method: Bank['method'];
  confirmed: boolean;
  omitted: boolean;
  /** The check digit failed and the person keeps the value as it is. */
  keep: boolean;
}
export type States = Record<Key, FieldState>;

export type Value =
  | { key: 'total' | 'vat'; minor: bigint }
  | { key: 'currency'; code: string }
  | { key: 'dueDate'; iso: string }
  | { key: 'bank'; bank: Bank }
  | { key: 'reference'; reference: PaymentReference };

export interface Resolved {
  value: Value | null;
  check: Check;
  detail?: string;
  /** The text could not be read as this kind of value, or means two. */
  problem?: 'unreadable' | 'ambiguous';
  flags: Flag[];
  where: Where | null;
}

export function initialStates(reading: InvoiceReading): States {
  const make = (key: Key): FieldState => {
    const first = reading[key].candidates[0] as Candidate<unknown> | undefined;
    const bank = first?.value as Bank | null | undefined;
    return {
      choice: 0,
      typed: null,
      method: bank?.method ?? 'bankgiro',
      confirmed: false,
      // VAT is never used; nothing found, nothing to ask.
      omitted: key === 'vat' && reading.vat.status === 'missing',
      keep: false,
    };
  };
  return Object.fromEntries(KEYS.map((key) => [key, make(key)])) as States;
}

function fromCandidate(key: Key, candidate: Candidate<unknown>): Value | null {
  const value = candidate.value;
  if (value === null) return null;
  switch (key) {
    case 'total':
    case 'vat':
      return { key, minor: value as bigint };
    case 'currency':
      return { key, code: value as string };
    case 'dueDate':
      return { key, iso: value as string };
    case 'bank':
      return { key, bank: value as Bank };
    case 'reference':
      return { key, reference: value as PaymentReference };
  }
}

export function resolve(key: Key, reading: InvoiceReading, state: FieldState): Resolved {
  const candidate = (reading[key].candidates[state.choice] ?? null) as Candidate<unknown> | null;
  const where = candidate?.where ?? null;

  if (state.typed === null) {
    if (!candidate) return { value: null, check: 'none', flags: [], where };
    const value = fromCandidate(key, candidate);
    return {
      value,
      check: candidate.check,
      ...(candidate.detail ? { detail: candidate.detail } : {}),
      ...(value === null ? { problem: 'unreadable' as const } : {}),
      flags: candidate.flags,
      where,
    };
  }

  const text = state.typed.trim();
  const none = (problem: 'unreadable' | 'ambiguous'): Resolved => ({
    value: null,
    check: 'none',
    problem,
    flags: [],
    where,
  });
  switch (key) {
    case 'total':
    case 'vat': {
      const parsed = parseAmount(text);
      if (parsed.status === 'invalid') return none('unreadable');
      // An offered thousands reading is shown in full beside the field; confirming it is the answer.
      const minor = parsed.status === 'ok' ? parsed.minor : parsed.candidates[0]!;
      return {
        value: { key, minor },
        check: 'none',
        flags: parsed.status === 'ask' ? ['format-unsure'] : [],
        where,
      };
    }
    case 'currency':
      return /^[A-Z]{3}$/.test(text)
        ? { value: { key, code: text }, check: 'none', flags: [], where }
        : none('unreadable');
    case 'dueDate': {
      const parsed = parseDate(text);
      if (parsed.status === 'invalid') return none('unreadable');
      if (parsed.status === 'ask') return none('ambiguous');
      return { value: { key, iso: parsed.iso }, check: 'none', flags: [], where };
    }
    case 'bank': {
      if (text === '') return none('unreadable');
      const check =
        state.method === 'bankgiro'
          ? checkBankgiro(text)
          : state.method === 'plusgiro'
            ? checkPlusgiro(text)
            : checkIban(text);
      return {
        value: { key, bank: { method: state.method, account: check.value } },
        check: check.check,
        flags: [],
        where,
      };
    }
    case 'reference': {
      if (text === '') return none('unreadable');
      const checked = checkReference(text);
      return {
        value: { key, reference: { kind: checked.kind, value: checked.value } },
        check: checked.check,
        ...(checked.detail ? { detail: checked.detail } : {}),
        flags: [],
        where,
      };
    }
  }
}

/** Whether a field has been settled by the person: nothing is ready until they say so. */
export function ready(key: Key, reading: InvoiceReading, state: FieldState): boolean {
  if (state.omitted) return !REQUIRED.includes(key);
  const resolved = resolve(key, reading, state);
  if (resolved.value === null || resolved.problem) return false;
  if (!state.confirmed) return false;
  return resolved.check !== 'failed' || state.keep;
}

export function canKeep(reading: InvoiceReading, states: States): boolean {
  return KEYS.every((key) => ready(key, reading, states[key]));
}

/** The record, only when every field is settled; null otherwise. */
export function buildRecord(
  reading: InvoiceReading,
  states: States,
  reviewedAt: Date,
): ReviewedPayable | null {
  if (!canKeep(reading, states)) return null;
  const get = (key: Key) => (states[key].omitted ? null : resolve(key, reading, states[key]).value);
  const total = get('total');
  const currency = get('currency');
  if (total?.key !== 'total' || currency?.key !== 'currency') return null;
  const due = get('dueDate');
  const bank = get('bank');
  const reference = get('reference');
  const vat = get('vat');
  return {
    version: 1,
    total: total.minor.toString(),
    currency: currency.code,
    dueDate: due?.key === 'dueDate' ? due.iso : null,
    bank: bank?.key === 'bank' ? bank.bank : null,
    reference: reference?.key === 'reference' ? reference.reference : null,
    vat: vat?.key === 'total' || vat?.key === 'vat' ? vat.minor.toString() : null,
    keptDespiteFailedCheck: KEYS.filter(
      (key) =>
        !states[key].omitted &&
        states[key].keep &&
        resolve(key, reading, states[key]).check === 'failed',
    ),
    reviewedAt: reviewedAt.toISOString(),
  };
}

/** A change to what is in front of the person takes their confirmation back. */
export function changed(state: FieldState, patch: Partial<FieldState>): FieldState {
  return { ...state, confirmed: false, keep: false, omitted: false, ...patch };
}
