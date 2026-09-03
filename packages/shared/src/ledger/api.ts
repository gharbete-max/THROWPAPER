import { z } from 'zod';
import { LocalisedText, Uuid } from '../api/common.js';

/**
 * The ledger over HTTP.
 *
 * ## Amounts travel as strings
 *
 * JSON has no integer type — it has `number`, which is a double, which cannot hold every value a
 * `bigint` can. `JSON.stringify` refuses a bigint outright rather than silently truncating it,
 * which is the correct behaviour and also means the wire format has to decide something.
 *
 * So an amount crosses the wire as a **decimal string of minor units**: `"12500"`, not `12500`
 * and not `125.00`. Minor units because that is what is stored and what balances; a string
 * because it is the only JSON type that survives arbitrary precision intact; and no decimal point
 * because the currency decides where one goes and putting it in early invites somebody to parse
 * it as a float on the way past.
 *
 * The regex is deliberately narrow. Anything that is not an optionally-signed run of digits is
 * refused rather than coerced.
 */
export const MinorAmount = z
  .string()
  .regex(/^-?\d+$/, 'An amount is a whole number of minor units, as a string');

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export const AccountType = z.enum(ACCOUNT_TYPES);
export type AccountType = z.infer<typeof AccountType>;

/**
 * An account code, as an accountant would write it: 1910, 3001, 2440.
 *
 * Text rather than a number — these are identifiers that happen to look numeric, they sort as
 * text, some charts use letters, and nobody ever adds two of them together.
 */
export const AccountCode = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits, dots, dashes and underscores');

export const CurrencyCode = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/, 'Three letters, ISO 4217')
  .transform((code) => code.toUpperCase());

export const LedgerAccountResponse = z.object({
  id: Uuid,
  code: AccountCode,
  name: LocalisedText,
  type: AccountType,
  archived: z.boolean(),
  /** Signed, in the direction this kind of account grows — see `accountBalance` in packages/calc. */
  balanceMinor: MinorAmount,
});

export const CreateLedgerAccount = z.object({
  code: AccountCode,
  name: LocalisedText,
  type: AccountType,
});

export const JournalLineInput = z
  .object({
    accountId: Uuid,
    debitMinor: MinorAmount.default('0'),
    creditMinor: MinorAmount.default('0'),
    memo: z.string().trim().max(200).optional(),
  })
  /**
   * One side, checked here as well as in the domain and in the database.
   *
   * Three places is not duplication: this one turns a malformed request into a 400 with a field
   * path, the domain one is what the posting logic actually asks, and the database one is what a
   * migration or a repair script runs into. They enforce the same rule at three different blast
   * radii.
   */
  .refine(
    (line) => (line.debitMinor === '0') !== (line.creditMinor === '0'),
    'A line carries either a debit or a credit, never both and never neither',
  )
  .refine(
    (line) => !line.debitMinor.startsWith('-') && !line.creditMinor.startsWith('-'),
    'Amounts are never negative; put it on the other side instead',
  );

export const JournalLineResponse = z.object({
  accountId: Uuid,
  accountCode: AccountCode,
  accountName: LocalisedText,
  debitMinor: MinorAmount,
  creditMinor: MinorAmount,
  memo: z.string().nullable(),
});

export const JournalEntryResponse = z.object({
  id: Uuid,
  reference: z.string(),
  description: z.string(),
  /** `YYYY-MM-DD`. When the thing happened, which is not when it was written down. */
  occurredOn: z.string().date(),
  postedAt: z.string().datetime({ offset: true }),
  postedByName: z.string().nullable(),
  currency: CurrencyCode,
  lines: z.array(JournalLineResponse),
  /** What this entry undoes, if it is a correction. */
  reversesEntryId: Uuid.nullable(),
  reversesReference: z.string().nullable(),
  /** What undid this entry, if something did. Its presence is why nothing needs deleting. */
  reversedByEntryId: Uuid.nullable(),
  reversedByReference: z.string().nullable(),
});

export const PostJournalEntry = z.object({
  description: z.string().trim().min(1).max(500),
  occurredOn: z.string().date(),
  currency: CurrencyCode,
  lines: z.array(JournalLineInput).min(2, 'An entry has at least two lines'),
});

/**
 * Reversing takes a reason and nothing else.
 *
 * The lines are not the caller's to choose: a reversal is *the* entry that undoes a specific one,
 * derived from it. Letting a client supply them would allow a "reversal" that reverses something
 * different, which is a hole in the audit trail wearing the word reversal.
 */
export const ReverseJournalEntry = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Defaults to today. A correction found in April to a March entry is dated when it is made. */
  occurredOn: z.string().date().optional(),
});

export const LedgerAccountListResponse = z.object({ accounts: z.array(LedgerAccountResponse) });
export const JournalEntryListResponse = z.object({
  entries: z.array(JournalEntryResponse),
  /**
   * The whole book's totals.
   *
   * Every entry balances alone, so these must be equal — which makes them a check of the storage
   * rather than of the arithmetic, and worth showing rather than assuming.
   */
  trialBalance: z.object({
    debitsMinor: MinorAmount,
    creditsMinor: MinorAmount,
    balanced: z.boolean(),
  }),
});

export type LedgerAccountResponse = z.infer<typeof LedgerAccountResponse>;
export type JournalEntryResponse = z.infer<typeof JournalEntryResponse>;
export type JournalLineInput = z.infer<typeof JournalLineInput>;
export type PostJournalEntry = z.infer<typeof PostJournalEntry>;
