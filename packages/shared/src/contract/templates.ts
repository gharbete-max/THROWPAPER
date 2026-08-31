import { z } from 'zod';

export const MergeFieldSpec = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'number', 'date', 'boolean']),
  required: z.boolean(),
  fallback: z.string().optional(),
});

/** CONTRACT §1.4 — so Formwork's admin UI offers real template keys, not free text. */
export const TemplateSummary = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['transactional', 'marketing']),
  locales: z.array(z.string()),
  mergeFields: z.array(MergeFieldSpec),
});

export const ListTemplatesResponse = z.object({ templates: z.array(TemplateSummary) });

export type TemplateSummary = z.infer<typeof TemplateSummary>;
