import type { ComposePurpose } from '@tp/shared/summary';

/**
 * Opening Send's compose step with something to write an email about: a summary, or the review
 * comments on a text. Like the other hand-offs it travels in the router's history state, in memory,
 * from one screen to the next — never in the URL and never stored. Send opens the reply helper on
 * it; the helper writes a draft, the person edits it, and nothing is sent without Send's own
 * confirmation step.
 */
export const EMAIL_ABOUT_ROUTE = '/send';

export interface EmailAbout {
  purpose: ComposePurpose;
  /** The summary, or the numbered review comments. Untrusted: it is only ever quoted to the model. */
  material: string;
  /** Passages the email has to quote word for word (a review's spans). */
  quotes: string[];
  /** Who it is for, when the person already said. */
  recipient: string;
  overall: 'good' | 'mixed';
}

export function emailAboutWith(about: EmailAbout): [string, { state: { emailAbout: EmailAbout } }] {
  return [EMAIL_ABOUT_ROUTE, { state: { emailAbout: about } }];
}

export function emailAboutFromState(state: unknown): EmailAbout | null {
  const about = (state as { emailAbout?: Partial<EmailAbout> } | null)?.emailAbout;
  if (!about || typeof about.material !== 'string' || about.material.trim() === '') return null;
  return {
    purpose: about.purpose === 'feedback' ? 'feedback' : 'summary',
    material: about.material,
    quotes: Array.isArray(about.quotes) ? about.quotes.filter((q) => typeof q === 'string') : [],
    recipient: typeof about.recipient === 'string' ? about.recipient : '',
    overall: about.overall === 'mixed' ? 'mixed' : 'good',
  };
}
