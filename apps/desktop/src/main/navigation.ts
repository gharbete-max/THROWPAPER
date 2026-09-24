/**
 * Where a link or a new window may go, for every window the shell opens.
 *
 * Pure functions, so the rules are tested without Electron (`navigation.test.ts`); `main.ts`
 * applies them to every webContents through `web-contents-created`, not to the main window alone.
 * A rule attached to one window was how a second window — opened by `window.open` from the first,
 * or a file dropped on the settings panel — ended up with no rules at all.
 */

/**
 * Schemes handed to the operating system. `shell.openExternal` passes a URL to whatever handler is
 * registered for its scheme, and `file:`, `smb:`, `search-ms:` and the `ms-*` family are known
 * ways to run a program on Windows. A link in this product goes to a website or starts an email;
 * nothing else leaves the app.
 */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function externalAllowed(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export type Opening =
  /** One of our pages, in a window of ours. `pdfViewer` for a PDF the page made itself. */
  | { action: 'window'; pdfViewer: boolean }
  /** Somebody else's page, in the user's own browser or mail program. */
  | { action: 'external' }
  | { action: 'deny' };

/**
 * A request for a new window (`window.open`, `target=_blank`).
 *
 * - Our origin → a window of ours: a form preview, the signing page.
 * - A `blob:` URL minted by our origin → a window of ours with the PDF viewer on: the finished
 *   document's "Open". The blob's origin is the page that created it, so a blob from anywhere else
 *   is not ours.
 * - http, https, mailto elsewhere → the system.
 * - Anything else → nothing.
 */
export function classifyOpen(url: string, origins: readonly string[]): Opening {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { action: 'deny' };
  }
  if (parsed.protocol === 'blob:') {
    return origins.includes(parsed.origin)
      ? { action: 'window', pdfViewer: true }
      : { action: 'deny' };
  }
  if (origins.includes(parsed.origin)) return { action: 'window', pdfViewer: false };
  return externalAllowed(url) ? { action: 'external' } : { action: 'deny' };
}

export type Navigation = 'allow' | 'external' | 'deny';

/**
 * A page navigating itself (a link without a target, a form post, a dropped file).
 *
 * A page of ours may move to another page of ours. The settings panel is a local file with a bridge
 * into the main process; it never navigates at all — a file dropped on it would otherwise replace
 * it with `file:///…` and hand that page the bridge.
 */
export function classifyNavigation(
  from: string,
  to: string,
  origins: readonly string[],
): Navigation {
  let source: URL;
  let target: URL;
  try {
    source = new URL(from);
    target = new URL(to);
  } catch {
    return 'deny';
  }
  if (source.protocol === 'file:') return 'deny';
  if (origins.includes(target.origin)) return 'allow';
  return externalAllowed(to) ? 'external' : 'deny';
}

/**
 * The one device permission the product uses is the camera — QR codes at the door, photographs of
 * paper. Not the microphone, and only for a page of ours.
 */
export function cameraAllowed(
  permission: string,
  requestingUrl: string,
  mediaTypes: readonly string[] | undefined,
  origins: readonly string[],
): boolean {
  if (permission !== 'media') return false;
  let origin: string;
  try {
    origin = new URL(requestingUrl).origin;
  } catch {
    return false;
  }
  if (!origins.includes(origin)) return false;
  // Absent for a permission *check*; present and video-only for a camera request.
  return (
    mediaTypes === undefined || (mediaTypes.length > 0 && mediaTypes.every((t) => t === 'video'))
  );
}

/**
 * Every permission a page of ours may have: the camera as above, and writing text to the
 * clipboard — "Copy link", "Copy message text" — which Electron asks about as
 * `clipboard-sanitized-write`. Reading the clipboard, location, notifications and the rest: no.
 */
export function permissionAllowed(
  permission: string,
  requestingUrl: string,
  mediaTypes: readonly string[] | undefined,
  origins: readonly string[],
): boolean {
  if (permission === 'clipboard-sanitized-write') {
    try {
      return origins.includes(new URL(requestingUrl).origin);
    } catch {
      return false;
    }
  }
  return cameraAllowed(permission, requestingUrl, mediaTypes, origins);
}
