import { z } from 'zod';
import { LocalisedText, Uuid } from '../api/common.js';
import { MinorAmount } from '../ledger/api.js';
import type { InvoiceLine } from './api.js';

/**
 * The charges an issuer defines, and the standing arrangement each recipient is on.
 *
 * ## There is no list of charge types in this product
 *
 * Rent is a charge. Cable television is a charge. So is a storage cupboard, a second parking space,
 * a service fee, a gym's joining fee and whatever a landlord decides to bill for next spring. The
 * issuer writes their own, because a fixed set is wrong for the second customer and every customer
 * after them, and because "miscellaneous" is not a category the software gets to define on their
 * behalf.
 *
 * ## Why a standing arrangement exists at all
 *
 * Rent recurs. Forty tenants, every month, each with their own figure and their own extras: typing
 * that in is not a workflow, it is a data-entry job with money in it. The arrangement is read once
 * per run and produces the lines.
 *
 * ## The one subtle decision
 *
 * A recipient's charge may leave its amount unset, which means "whatever the charge type currently
 * says". That is what makes raising cable television across a property one edit rather than forty.
 * Rent, which differs per tenant, carries its own figure and ignores the default.
 *
 * The cost is that changing a default changes what everybody on it will be billed next time. It
 * cannot touch an invoice already issued — invoices copy their lines — so the blast radius is the
 * next run, and a run has to be confirmed before it sends. That is the trade being made, and it is
 * made deliberately rather than by omission.
 */

export const ChargeType = z.object({
  id: Uuid,
  name: LocalisedText,
  /** What this costs unless a recipient has their own figure. */
  defaultUnitAmount: MinorAmount,
  vatRateBasisPoints: z.number().int().min(0).max(10_000).default(0),
  archived: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});
export type ChargeType = z.infer<typeof ChargeType>;

export const RecipientCharge = z.object({
  chargeTypeId: Uuid,
  /** Omitted means: use the charge type's default at the moment the invoice is made. */
  unitAmount: MinorAmount.optional(),
  quantity: z.string().regex(/^\d+$/).default('1000'),
  position: z.number().int().min(0).default(0),
});
export type RecipientCharge = z.infer<typeof RecipientCharge>;

/**
 * A charge added to one invoice and no other: a repair, a replaced key, a month's parking a tenant
 * asked for once.
 *
 * Deliberately not a charge type. Making the issuer define "Replacement key, 350 kr" in a catalogue
 * before they can bill for it once is the kind of ceremony that makes people keep a spreadsheet
 * beside the system instead.
 */
export const OneOffCharge = z.object({
  description: LocalisedText,
  unitAmount: MinorAmount,
  quantity: z.string().regex(/^\d+$/).default('1000'),
  vatRateBasisPoints: z.number().int().min(0).max(10_000).default(0),
});
export type OneOffCharge = z.infer<typeof OneOffCharge>;

export class ChargeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChargeResolutionError';
  }
}

/**
 * Turn a recipient's standing arrangement into the lines of one invoice.
 *
 * Pure, and returns lines without amounts: what a line costs is `totals.ts`'s arithmetic, and doing
 * it in two places is how a total ends up disagreeing with the column above it.
 *
 * Archived charge types are refused rather than skipped. Silently dropping a line produces an
 * invoice that is quietly short, which a tenant will not query and a landlord will not notice —
 * whereas a run that stops and says which charge was retired is a problem somebody fixes in a
 * minute.
 */
export function resolveCharges(
  charges: readonly RecipientCharge[],
  catalogue: readonly ChargeType[],
  oneOffs: readonly OneOffCharge[] = [],
): Array<Omit<InvoiceLine, 'amount'>> {
  const byId = new Map(catalogue.map((type) => [type.id, type]));

  const standing = [...charges]
    .sort((a, b) => a.position - b.position)
    .map((charge) => {
      const type = byId.get(charge.chargeTypeId);
      if (!type) {
        throw new ChargeResolutionError(
          `No charge type ${charge.chargeTypeId}; the invoice would be short a line`,
        );
      }
      if (type.archived) {
        throw new ChargeResolutionError(
          `Charge type ${charge.chargeTypeId} is archived but still on a recipient`,
        );
      }

      return {
        description: type.name,
        quantity: charge.quantity,
        /* The recipient's own figure, or the catalogue's, decided here and only here. */
        unitAmount: charge.unitAmount ?? type.defaultUnitAmount,
        vatRateBasisPoints: type.vatRateBasisPoints,
      };
    });

  return [...standing, ...oneOffs.map((charge) => ({ ...charge }))];
}
