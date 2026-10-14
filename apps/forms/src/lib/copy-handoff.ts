import type { RecognisedWords } from '../screens/builder/paper/ocr-words.js';

/**
 * Opening a form's paper import with a page already read — the digital copy's "A form" button.
 * The photograph and its words travel in the router's history state: in memory, from one screen
 * to the next, never in the URL and never stored. The import then reads those words as it reads
 * any photograph's, and does not read the picture again.
 */
export interface HandedPage {
  photo: File;
  recognised: RecognisedWords;
}

/** Arguments for `navigate`: `navigate(...copyToForm(formId, page))`. */
export function copyToForm(
  formId: string,
  page: HandedPage,
): [string, { state: { copyPage: HandedPage } }] {
  return [`/forms/${formId}/import`, { state: { copyPage: page } }];
}

/** The page a digital copy handed over, or `null` when the screen was opened any other way. */
export function pageFromState(state: unknown): HandedPage | null {
  const page = (state as { copyPage?: Partial<HandedPage> } | null)?.copyPage;
  return page?.photo instanceof File && page.recognised ? (page as HandedPage) : null;
}
