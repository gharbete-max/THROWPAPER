/**
 * Opening Send with a document already chosen — the one entry point any part uses (Scan's arranged
 * PDF, Forms' PDF, a PDF with its text edited, a PDF made from Word). Mirrors `sign-handoff.ts`:
 * the file travels in the router's history state, in memory, from one screen to the next — never
 * in the URL (a document is not an address) and never stored. Send then asks, and sends nothing
 * until the person has confirmed.
 */
export const SEND_ROUTE = '/send';

/** Arguments for `navigate`: `navigate(...sendWith(file))`. */
export function sendWith(file: File): [string, { state: { sendFile: File } }] {
  return [SEND_ROUTE, { state: { sendFile: file } }];
}

/** The document a part handed over, or `null` when the screen was opened any other way. */
export function sendFileFromState(state: unknown): File | null {
  const file = (state as { sendFile?: unknown } | null)?.sendFile;
  return file instanceof File ? file : null;
}

/** What Send can attach: a PDF, or a Word file as it was brought in. */
export function isSendable(file: File): boolean {
  return /\.(pdf|docx)$/i.test(file.name) || file.type === 'application/pdf';
}

/** A subject to start from: the file's name without its extension. */
export function subjectOf(file: File): string {
  return file.name.replace(/\.(pdf|docx)$/i, '');
}

/**
 * Addresses from what a person typed or pasted: split on lines, commas, semicolons and spaces,
 * once each whatever the capitals (the first spelling stays), as the server will count them.
 */
export function addressesOf(text: string): string[] {
  const seen = new Map<string, string>();
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim();
    if (address && !seen.has(address.toLowerCase())) seen.set(address.toLowerCase(), address);
  }
  return [...seen.values()];
}
