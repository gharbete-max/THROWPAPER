import { MAX_GROUP_ENTRIES } from './definition.js';

/**
 * Who a card is for, written as one string.
 *
 * A registration is one row with one reference, and that stays true — `submissions_org_reference_idx`
 * is unique and the CSV design rests on it. A guest is not a second row; a guest is **that
 * reference and an ordinal**, and nothing is stored to say so:
 *
 * ```
 * ABCD-EFGH      the registrant
 * ABCD-EFGH:1    their first guest
 * ABCD-EFGH:2    their second
 * ```
 *
 * See `docs/adr/0003-repeating-groups.md`. The short version is that minting a real reference per
 * guest would put three rows in the table whose uniqueness was the thing keeping the export and
 * the database agreeing about what a submission is.
 */

/**
 * `:` and not `-`, because `-` is already in a reference.
 *
 * A reference is `XXXX-XXXX` over an alphabet that includes digits, so `ABCD-1234` is a reference
 * that already exists — and hyphen-numbering would read it as entry 1234 of a submission called
 * `ABCD`. That is not a rare collision to handle; it is an ambiguity in the grammar. The separator
 * has to be something the alphabet cannot produce.
 */
export const ENTRY_SEPARATOR = ':';

/**
 * The registrant themself.
 *
 * Nought rather than a null or a flag, so the number in the reference and the number in
 * `check_ins.entry_index` are the same number and "who is this card for" has one answer everywhere.
 */
export const REGISTRANT_ENTRY = 0;

export interface ParsedReference {
  /** The submission's own reference, exactly as it is stored. */
  reference: string;
  /** 0 for the registrant, 1-based for an entry of the admitting group. */
  entryNumber: number;
}

/** What goes on the card, and into the QR. `entryNumber` 0 gives the reference back unchanged. */
export function entryReference(reference: string, entryNumber: number): string {
  return entryNumber === REGISTRANT_ENTRY
    ? reference
    : `${reference}${ENTRY_SEPARATOR}${entryNumber}`;
}

/**
 * Read a scanned or typed code back into a submission and an ordinal.
 *
 * `null` for anything malformed — an ordinal that is not a plain number, is nought or negative, or
 * is above the cap a group could ever have had. Returning a best guess would mean the door looking
 * up a submission that the person in front of it was never holding a card for.
 *
 * The ordinal is **not** checked against what the submission actually answered: that needs the
 * definition, and this function is pure string work that both the door and the card renderer use.
 * `checkIn` does that part, where it has the data to do it with.
 */
export function parseEntryReference(value: string): ParsedReference | null {
  const trimmed = value.trim().toUpperCase();
  if (trimmed === '') return null;

  const parts = trimmed.split(ENTRY_SEPARATOR);
  if (parts.length === 1) return { reference: trimmed, entryNumber: REGISTRANT_ENTRY };
  if (parts.length !== 2) return null;

  const [reference, ordinal] = parts;
  if (!reference || !ordinal || !/^\d{1,2}$/.test(ordinal)) return null;

  const entryNumber = Number(ordinal);
  if (entryNumber < 1 || entryNumber > MAX_GROUP_ENTRIES) return null;

  return { reference, entryNumber };
}
