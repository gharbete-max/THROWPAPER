/**
 * How big an attachment is before it is worth a warning. Many mail systems refuse or bounce a
 * message much over 10 MB once it is encoded, and slow connections feel it sooner, so above this
 * the confirmation says so and offers "Make smaller". It is a nudge, not a limit: the limit is
 * `SEND_LIMITS.attachmentBytes`.
 */
export const ATTACHMENT_WARN_BYTES = 10 * 1024 * 1024;

export const isHeavy = (bytes: number): boolean => bytes > ATTACHMENT_WARN_BYTES;

/** `3.2 MB`, never less than `0.1 MB`. */
export const formatMegabytes = (bytes: number): string =>
  `${Math.max(0.1, bytes / 1024 / 1024).toFixed(1)} MB`;

/** "Make smaller" can only do something for a PDF; a Word file is sent as it was brought in. */
export const canShrink = (file: { name: string; type?: string }): boolean =>
  /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
