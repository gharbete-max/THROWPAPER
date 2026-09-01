import { z } from 'zod';

/**
 * A reference to a file in this application's own asset store.
 *
 * **Never an arbitrary URL**, and that is the whole point of the type existing. These values are
 * written by a customer — in a brand kit, in a form definition — and they end up in `src`
 * attributes on public pages and in email. Accepting any URL would let one organisation point
 * every form it publishes at a third-party host, which leaks each visitor's IP address to that
 * host on every page load and hands whoever controls it the ability to change what the form
 * appears to show.
 *
 * The shape is fixed because the upload endpoint keys files by the SHA-256 of their content, so a
 * legitimate reference is always 64 hex characters and a known extension. Nothing an uploader
 * chose — a filename, a path, a host — can survive into one.
 */
export const AssetPath = z
  .string()
  .trim()
  .regex(
    /^\/public\/assets\/[0-9a-f]{64}\.(png|jpg|webp|gif)$/,
    'Upload an image and use the path it returns',
  );

export type AssetPath = z.infer<typeof AssetPath>;
