import { z } from 'zod';

/**
 * Scanning with a phone for a computer (the desktop app, or a browser on a PC without a good
 * camera). The computer opens a short-lived session and shows its link as a QR code; the phone
 * opens the link, photographs pages and sends them; the computer collects them as if its own
 * camera had taken them. Forms' own API, not the contract.
 */
export const PHONE_SCAN_MAX_PAGES = 20;
/** One photographed page, as the phone sends it. ~6 MB of image. */
export const PhoneScanPage = z.object({
  contentType: z.enum(['image/jpeg', 'image/png']),
  base64: z.string().min(1).max(8_000_000),
});
export type PhoneScanPage = z.infer<typeof PhoneScanPage>;

/** What the computer sees of its session. */
export const PhoneScanSession = z.object({
  id: z.string().uuid(),
  /** The link the phone opens. Only this session's pages can be sent through it. */
  phoneUrl: z.string(),
  /** The same link as an SVG QR code, for the phone to read off the screen. */
  qrSvg: z.string(),
  expiresAt: z.string(),
  pages: z.number().int().min(0),
});
export type PhoneScanSession = z.infer<typeof PhoneScanSession>;

/** What the phone sees: how many pages have arrived, and until when it may send more. */
export const PhoneScanStatus = z.object({
  pages: z.number().int().min(0),
  maxPages: z.number().int(),
  expiresAt: z.string(),
});
export type PhoneScanStatus = z.infer<typeof PhoneScanStatus>;
