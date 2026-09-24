/**
 * What the confirmation screen remembers, so a refresh shows it again instead of an empty form.
 *
 * ## Where: the history entry, not storage
 *
 * It rides on the browser's history entry (React Router's navigation `state`, which lives in
 * `history.state`). That is exactly the lifetime wanted:
 *
 * - **a refresh**, and Back or Forward onto the entry, bring the confirmation back — the person
 *   who presses F5 on "thank you" is not shown a blank form and left wondering whether it went;
 * - **a new visit to the link** — clicking it again in an email, the next person at a reception
 *   desk — is a new entry with no state, and shows the form as it should.
 *
 * `sessionStorage` did the first and broke the second: opening the form's link again in the same
 * tab showed the last person's confirmation.
 *
 * ## What
 *
 * Only what the screen showed: the reference, the organisation's message, where a mail is going,
 * the language it was in, and the handle for the finished document. **Never the answers.** The
 * document's token is a credential for one submission that the server stops honouring after a day;
 * the same limit here only stops an old entry offering a button that cannot work.
 */
export interface RememberedFinish {
  reference: string;
  confirmation: string;
  coming: { email: string; card: boolean } | null;
  document: { token: string; filename: string; draftProgram: string | null } | null;
  locale: string;
}

const KEY = 'loppaFinished';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Navigation state carrying the confirmation, field by field — nothing else a caller had. */
export function finishedState(
  finished: RememberedFinish,
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    [KEY]: {
      reference: finished.reference,
      confirmation: finished.confirmation,
      coming: finished.coming,
      document: finished.document,
      locale: finished.locale,
      at: now.getTime(),
    },
  };
}

/** The confirmation in this navigation state, if there is a recent, well-formed one. */
export function readFinished(state: unknown, now: Date = new Date()): RememberedFinish | null {
  if (!state || typeof state !== 'object') return null;
  const raw = (state as Record<string, unknown>)[KEY];
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<RememberedFinish> & { at?: unknown };
  if (
    typeof parsed.reference !== 'string' ||
    typeof parsed.at !== 'number' ||
    now.getTime() - parsed.at > MAX_AGE_MS ||
    now.getTime() < parsed.at
  ) {
    return null;
  }
  const document = parsed.document;
  return {
    reference: parsed.reference,
    confirmation: typeof parsed.confirmation === 'string' ? parsed.confirmation : '',
    coming:
      parsed.coming && typeof parsed.coming.email === 'string'
        ? { email: parsed.coming.email, card: parsed.coming.card === true }
        : null,
    document:
      document && typeof document.token === 'string' && typeof document.filename === 'string'
        ? {
            token: document.token,
            filename: document.filename,
            draftProgram: typeof document.draftProgram === 'string' ? document.draftProgram : null,
          }
        : null,
    locale: typeof parsed.locale === 'string' ? parsed.locale : '',
  };
}
