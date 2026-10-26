import { z } from 'zod';

/**
 * Product API schemas — the endpoints apps/forms calls.
 *
 * Deliberately kept beside `contract/`, not inside it: the integration contract between the two
 * products is versioned and frozen by joint decision, while this surface belongs to Loppa
 * alone and changes with its UI.
 */
/** `guid`, not `uuid`: Zod 3 took any 8-4-4-4-12 hex string; Zod 4's `uuid` also checks version and variant bits. */
export const Uuid = z.guid();
export const Locale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export const Email = z.string().email().max(320);

/** Text stored per locale — see packages/i18n pickText(). */
export const LocalisedText = z.record(Locale, z.string());

export const Role = z.enum(['admin', 'operator']);
export type Role = z.infer<typeof Role>;

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level detail for validation failures. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/**
 * An amount of money over HTTP, shared by invoicing and the ledger.
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
