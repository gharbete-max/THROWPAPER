import { z } from 'zod';

/**
 * Product API schemas — the endpoints apps/forms calls.
 *
 * Deliberately kept beside `contract/`, not inside it: the integration contract between the two
 * products is versioned and frozen by joint decision, while this surface belongs to Formwork
 * alone and changes with its UI.
 */
export const Uuid = z.string().uuid();
export const Locale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export const Email = z.string().email().max(320);

/** Text stored per locale — see packages/i18n pickText(). */
export const LocalisedText = z.record(Locale, z.string());

export const Role = z.enum(['admin', 'operator']);
export type Role = z.infer<typeof Role>;

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level detail for validation failures. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
