import { utf8Bytes } from '../import/sha256.js';

/**
 * Stable question ids — `docs/plan/PREDICTIVE-BUILDER.md`, "Stable ids"; `CAVEATS.md` #39, #49.
 *
 * A question's id is made once and never changes: not on a rename, not on a reorder, not on a
 * re-import. Responses, paper overlays and the builder's sidecar all point at it. So it is seeded
 * from a fingerprint of what the question is and where it was made, not from a random number:
 * the same conversation, or the same import, gives the same ids on every machine. And an id that
 * was ever used in the form is never handed to a new question, even an identical one in the same
 * place — the new one takes the next suffix — because an old answer would otherwise attach to it.
 *
 * Integer arithmetic only (BigInt for the 64-bit hash), per the purity rules.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a, 64-bit, over the UTF-8 bytes of the text. */
export function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of utf8Bytes(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/** Crockford's base-32 alphabet, lower case: no i, l, o or u to misread. */
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';

/** A 64-bit value as 13 base-32 digits, most significant first. */
export function base32(value: bigint): string {
  let out = '';
  for (let shift = 60n; shift >= 0n; shift -= 5n) {
    out += BASE32[Number((value >> shift) & 31n)];
  }
  return out;
}

/** The text a fingerprint is taken of: NFKC, lower case, runs of white space as one space. */
export function normaliseForFingerprint(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * What a question is and where it was made: `normalise(seed) | ordinal | sectionId`.
 *
 * `seed` is the question's source text for an import, and the key, vocabulary word or type the
 * conversation created it from for a guided one. `ordinal` is its 1-based position when it was
 * made, and `sectionId` the id of the section it was made in (empty before any section).
 */
export function fingerprint(seed: string, ordinal: number, sectionId: string): string {
  return `${normaliseForFingerprint(seed)}|${ordinal}|${sectionId}`;
}

/**
 * `q-` and the fingerprint's hash; if that id was ever used — in `taken`, which is the form's
 * current ids and its sidecar's `retiredIds` — the next free suffix, `-2`, `-3`, …
 */
export function stableFieldId(print: string, taken: ReadonlySet<string>): string {
  const base = `q-${base32(fnv1a64(print))}`;
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const id = `${base}-${suffix}`;
    if (!taken.has(id)) return id;
  }
}

/** The longest a field key may be (`FieldKey`), less room for a suffix. */
const KEY_ROOM = 60;

/**
 * A field key not already in use: the wanted one, else it with `_2`, `_3`, … — the classic
 * editor's rule, so a copy of `email_2` is `email_3`, not `email_2_2`. Keys are what submissions
 * are stored by, so two fields sharing one would lose answers (`definitionProblems` refuses it at
 * publish; this keeps the conversation from ever producing it).
 */
export function uniqueKey(wanted: string, taken: ReadonlySet<string>): string {
  const base = wanted.replace(/_\d+$/, '').slice(0, KEY_ROOM);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const key = `${base}_${suffix}`;
    if (!taken.has(key)) return key;
  }
}
