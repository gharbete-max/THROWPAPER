/**
 * Opening Signing with a PDF already chosen — the one entry point any part uses (Scan's PDF now,
 * Forms' PDF when it has one). The file travels in the router's history state: in memory, handed
 * from one screen to the next, never in the URL (a PDF is not an address) and never stored.
 */
export const SIGNING_ROUTE = '/signing';

/** Arguments for `navigate`: `navigate(...signingWith(file))`. */
export function signingWith(file: File): [string, { state: { signPdf: File } }] {
  return [SIGNING_ROUTE, { state: { signPdf: file } }];
}

/** The PDF a part handed over, or `null` when the screen was opened any other way. */
export function pdfFromState(state: unknown): File | null {
  const file = (state as { signPdf?: unknown } | null)?.signPdf;
  return file instanceof File ? file : null;
}

/** A document's name from its file name: without the extension, as the Signing form wants it. */
export function documentNameOf(file: File): string {
  return file.name.replace(/\.(pdf|jpe?g|png)$/i, '');
}
