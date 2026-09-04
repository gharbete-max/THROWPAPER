import { z } from 'zod';
import { Email, LocalisedText, Uuid } from '../api/common.js';
import { MinorAmount } from '../ledger/api.js';

/**
 * Invoices, over HTTP.
 *
 * ## Why this is not "rent"
 *
 * The first customer for this is rental property: a landlord sending the month's rent to every
 * tenant, each with cable television and a parking space on it. But nothing below knows what a
 * tenant is. An invoice has a recipient, a period it covers, and a list of lines with amounts,
 * and that is as true of a sports club's membership fees or a consultancy's monthly retainer.
 *
 * Rent is therefore a **template** over this model rather than a shape inside it. The alternative
 * was a `rent` table with a `cableTvIncluded` column, which works exactly once and then has to be
 * widened for every sector after it.
 *
 * ## Amounts
 *
 * Minor units, as decimal strings, exactly as the ledger does it: `"895000"` is 8 950,00 kr. JSON
 * has no integer type, `bigint` will not serialise, and a float cannot hold a krona amount
 * reliably. `CLAUDE.md` rule 5 is not a style preference here — an invoice that is one öre out is
 * an invoice a tenant queries.
 *
 * ## The reference is not in this file's gift
 *
 * `ocr` is a Swedish payment reference with a length digit and a Luhn check digit, built by
 * `ocr.ts`. It has to be unique for the organisation issuing it, and that is enforced by a unique
 * index in the database rather than by anything here. A schema can say a string is well formed; it
 * cannot say it has never been used before.
 */

export const CURRENCIES = ['SEK', 'EUR', 'NOK', 'DKK'] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof Currency>;

/**
 * How the recipient is asked to pay.
 *
 * Bankgiro and Plusgiro are the Swedish giro systems; IBAN covers the rest. The account number is
 * held as text because it is an identifier with meaningful leading zeros and internal spacing,
 * never a quantity.
 */
export const PAYMENT_METHODS = ['bankgiro', 'plusgiro', 'iban'] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const PaymentDetails = z.object({
  method: PaymentMethod,
  /** As printed: "123-4567" for a bankgiro, an IBAN with its spacing. Never parsed as a number. */
  account: z.string().trim().min(1).max(64),
  /**
   * Whether the recipient's giro agreement expects a length digit as well as a check digit.
   *
   * A property of the agreement, not a preference: a reference built the wrong way is rejected on
   * every payment, so it travels with the payment details rather than being decided per invoice.
   */
  ocrLengthControl: z.boolean().default(true),
});
export type PaymentDetails = z.infer<typeof PaymentDetails>;

/**
 * One line on an invoice.
 *
 * `description` is localised because a tenant reads the invoice in their own language, and "Kabel-
 * TV" is not a translation the system can invent. Quantity is a string of thousandths so that
 * "1.5 months" or "0.333 of a shared meter" survives without a float appearing anywhere near an
 * amount that has to add up.
 */
export const InvoiceLine = z.object({
  description: LocalisedText,
  /** Thousandths. `"1000"` is one, `"1500"` is one and a half. */
  quantity: z.string().regex(/^\d+$/).default('1000'),
  unitAmount: MinorAmount,
  /**
   * The line total, sent rather than inferred.
   *
   * Rounding a quantity against a unit price is a decision with money in it, and the server that
   * made the invoice is the one that should make it. A client recomputing it and disagreeing by an
   * öre is how an invoice and its PDF stop matching.
   */
  amount: MinorAmount,
  /** VAT rate in basis points: 2500 is 25%. Rent is usually exempt, hence the default. */
  vatRateBasisPoints: z.number().int().min(0).max(10_000).default(0),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const INVOICE_STATUSES = ['draft', 'issued', 'sent', 'paid', 'cancelled'] as const;
export const InvoiceStatus = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

/**
 * Who is being invoiced.
 *
 * Held on the invoice rather than only referenced, because an invoice is a record of what was sent
 * on a day. A tenant who moves must not silently rewrite the address on last year's invoices, and
 * a name corrected today must not change what the bookkeeping says was issued in March.
 */
export const InvoiceRecipient = z.object({
  name: z.string().trim().min(1).max(200),
  email: Email.optional(),
  /** Free text, because an address is not a schema anybody agrees on across borders. */
  address: z.string().trim().max(500).optional(),
  /** The landlord's own reference: an apartment number, a customer number, a member number. */
  externalReference: z.string().trim().max(64).optional(),
});
export type InvoiceRecipient = z.infer<typeof InvoiceRecipient>;

export const Invoice = z.object({
  id: Uuid,
  /** Sequential per organisation, never reused, and what the OCR is built from. */
  number: z.number().int().positive(),
  ocr: z.string().regex(/^\d{4,25}$/),
  status: InvoiceStatus,
  currency: Currency,
  recipient: InvoiceRecipient,
  /** What this invoice is for: "Rent, October 2026", "Membership 2026". */
  subject: LocalisedText,
  /**
   * The period the charge covers, when it covers one.
   *
   * Rent does; a one-off repair does not. Both dates inclusive, as an accountant reads them.
   */
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  issuedOn: z.string().date(),
  dueOn: z.string().date(),
  lines: z.array(InvoiceLine).min(1),
  /** The sum of the lines, computed once by the server. */
  total: MinorAmount,
  vatTotal: MinorAmount,
  payment: PaymentDetails,
  /**
   * The token in the public link, which is not the OCR.
   *
   * The OCR is printed on the invoice, quoted in bank statements and readable by anyone handling
   * the payment. Using it to authorise a web page would mean anybody who has seen a payment line
   * can open the invoice behind it. This is separate, random, and long.
   */
  publicToken: z.string().min(24).max(64),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().optional(),
  paidAt: z.string().datetime().optional(),
});
export type Invoice = z.infer<typeof Invoice>;

/** What a public visitor is allowed to see: the invoice, without the internal identifiers. */
export const PublicInvoice = Invoice.omit({
  id: true,
  publicToken: true,
  status: true,
}).extend({
  /** Only whether it is settled, not the internal state machine. */
  settled: z.boolean(),
  organisationName: z.string(),
});
export type PublicInvoice = z.infer<typeof PublicInvoice>;

export const CreateInvoice = z.object({
  currency: Currency.default('SEK'),
  recipient: InvoiceRecipient,
  subject: LocalisedText,
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  issuedOn: z.string().date(),
  dueOn: z.string().date(),
  lines: z.array(InvoiceLine.omit({ amount: true })).min(1),
  payment: PaymentDetails,
});
export type CreateInvoice = z.infer<typeof CreateInvoice>;

/**
 * Issuing a batch: one run that produces many invoices from one template.
 *
 * This is the rent case. A landlord has 40 tenants, each with their own lines, and wants one
 * action that produces 40 invoices with 40 references, then one action that sends them.
 *
 * Creating and sending are deliberately separate. `CLAUDE.md` rule 7: nothing sends without a
 * confirmation step, and forty emails with a wrong amount on them is not a mistake anybody can
 * take back.
 */
export const CreateInvoiceBatch = z.object({
  /** What the run is called in the list afterwards: "Rent, October 2026". */
  name: z.string().trim().min(1).max(200),
  currency: Currency.default('SEK'),
  issuedOn: z.string().date(),
  dueOn: z.string().date(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  subject: LocalisedText,
  payment: PaymentDetails,
  invoices: z
    .array(
      z.object({
        recipient: InvoiceRecipient,
        lines: z.array(InvoiceLine.omit({ amount: true })).min(1),
      }),
    )
    .min(1)
    .max(2000),
});
export type CreateInvoiceBatch = z.infer<typeof CreateInvoiceBatch>;

/**
 * Sending a batch.
 *
 * `testMode` is rule 7's other half: every outbound action has one. In test mode the run does
 * everything except hand the messages to the provider, and reports what it would have sent to
 * whom, so a landlord can check forty addresses before forty tenants read them.
 */
export const SendInvoiceBatch = z.object({
  testMode: z.boolean().default(true),
  /** Where a test run's messages go instead. Required in test mode so nothing is merely discarded. */
  testRecipient: Email.optional(),
});
export type SendInvoiceBatch = z.infer<typeof SendInvoiceBatch>;
