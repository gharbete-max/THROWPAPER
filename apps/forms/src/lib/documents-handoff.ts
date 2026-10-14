/**
 * The hand-offs between the parts of Documents that have no handoff of their own yet. Like
 * `sign-handoff.ts` and `send-handoff.ts`, each travels in the router's history state: in memory,
 * from one screen to the next, never in the URL and never stored.
 *
 * - Files dropped on the room are handed to Scan, which finds out what each one is.
 * - A PDF handed to the form-filling screen, and a PDF handed to the Summary pane (which reads its
 *   text itself, on this computer, as it does for a file chosen there).
 */
export const SCAN_ROUTE = '/scan';
export const FILL_ROUTE = '/forms/pdf';
export const SUMMARY_ROUTE = '/summary';

export function scanWith(files: File[]): [string, { state: { dropped: File[] } }] {
  return [SCAN_ROUTE, { state: { dropped: files } }];
}

export function droppedFromState(state: unknown): File[] {
  const files = (state as { dropped?: unknown } | null)?.dropped;
  return Array.isArray(files) ? files.filter((file): file is File => file instanceof File) : [];
}

export function fillWith(file: File): [string, { state: { fillPdf: File } }] {
  return [FILL_ROUTE, { state: { fillPdf: file } }];
}

export function fillPdfFromState(state: unknown): File | null {
  const file = (state as { fillPdf?: unknown } | null)?.fillPdf;
  return file instanceof File ? file : null;
}

export function summaryWith(file: File): [string, { state: { summaryFile: File } }] {
  return [SUMMARY_ROUTE, { state: { summaryFile: file } }];
}

export function summaryFileFromState(state: unknown): File | null {
  const file = (state as { summaryFile?: unknown } | null)?.summaryFile;
  return file instanceof File ? file : null;
}
