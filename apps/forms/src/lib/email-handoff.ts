/**
 * Handing a finished document to the person's own email.
 *
 * Three ways, best first, and the page says honestly what each one does:
 *
 * 1. **A draft in their mail program with the PDF attached** — the desktop edition only, where the
 *    local server can drive Outlook or Apple Mail (`api-forms/src/mail/draft.ts`).
 * 2. **The system share sheet with the file** — `navigator.share({ files })`. Where a browser
 *    supports sharing files (phones, and Safari and Edge on the desktop), Mail is one of the
 *    targets and the PDF arrives attached.
 * 3. **`mailto:`** — opens whatever email app is set up, with the subject and body written. It
 *    **cannot attach a file**: RFC 6068 has no attachment parameter, and the clients that once
 *    honoured a non-standard one stopped because it let any web page mail any file off the
 *    computer. So the page never implies it did; it says to attach the downloaded PDF, by name.
 *
 * Copying the message text is always offered too, for webmail in another tab.
 */

export interface EmailText {
  subject: string;
  body: string;
  /** Who it goes to, when the message already knows (the desktop's To send). */
  to?: string;
}

/**
 * A `mailto:` link, with the subject and body percent-encoded as RFC 6068 asks: spaces as `%20`
 * (not `+`, which some clients print), and line breaks as `%0D%0A`. With no `to` the person
 * chooses who it goes to; with one, it is the address and nothing else — encoded, so an address
 * cannot add headers of its own.
 */
export function mailtoHref(text: EmailText): string {
  const encode = (value: string) =>
    encodeURIComponent(value.replace(/\r?\n/g, '\r\n')).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const to = text.to ? encode(text.to.trim()).replace(/%40/g, '@') : '';
  return `mailto:${to}?subject=${encode(text.subject)}&body=${encode(text.body)}`;
}

/** Everything a clipboard paste into a webmail compose window needs. */
export function copyableDraft(text: EmailText): string {
  return `${text.subject}\n\n${text.body}`;
}

/** Whether this browser can put this file on the share sheet. False wherever it is unknown. */
export function canShareFile(
  file: File,
  nav: Navigator | undefined = globalThis.navigator,
): boolean {
  try {
    return (
      typeof nav?.share === 'function' &&
      typeof nav.canShare === 'function' &&
      nav.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/** Opens the share sheet with the file. A person closing it is not a failure. */
export async function shareFile(
  file: File,
  text: EmailText,
  nav: Navigator = globalThis.navigator,
): Promise<ShareOutcome> {
  try {
    await nav.share({ files: [file], title: text.subject, text: text.body });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** Saves a blob under its own name, the way a download link would. */
export function saveBlob(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough for the download to start everywhere; a revoked URL mid-download fails it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
