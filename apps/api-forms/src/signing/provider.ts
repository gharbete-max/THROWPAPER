/**
 * The signing seam.
 *
 * Two families of service are coming, and they are not the same shape:
 *
 * - **Agreement services** — Scrive, DocuSign, Dropbox Sign. You hand them a document and a list
 *   of parties; they host the signing page, chase people by email, and hand back a sealed PDF with
 *   an evidence log attached to it.
 * - **Identity services** — BankID (SE), MitID (DK), BankID (NO), FTN (FI), itsme (BE). These do
 *   not sign documents at all. They assert *who somebody is*, against a national scheme, and hand
 *   back a signature over a hash you gave them. Turning that into a signed document is your job.
 *
 * Almost every integration that goes wrong picks one of those shapes, ships it, and bolts the
 * other on later — which is how you end up with a "signed" record that is really a click-through,
 * indistinguishable in the database from one backed by a national eID.
 *
 * So `kind` is on the provider and `evidence.kind` is on the result, and neither is optional. A
 * Danish auditor asking "was this MitID or a drawn squiggle?" gets an answer from the row.
 *
 * Nothing here talks to a real service yet. BankID and MitID both need a merchant agreement and
 * client certificates that have to be obtained by a person, and Scrive needs an account; the
 * console provider exists so the whole flow — request, redirect, poll, download — can be built and
 * tested before any of that exists, exactly as the console mail provider does for sending.
 */

/** How a signature was actually obtained. Never inferred, never defaulted. */
export type SigningKind =
  /** A hosted agreement service returned a sealed document. */
  | 'agreement'
  /** A national eID asserted an identity over a document hash. */
  | 'identity'
  /** A drawn mark captured in the form itself. Not a qualified signature, and says so. */
  | 'drawn';

export type SigningStatus = 'pending' | 'signed' | 'declined' | 'expired' | 'failed';

export interface SigningParty {
  /** Stable within one request, so a status result can say which party it refers to. */
  id: string;
  name: string;
  email?: string;
  /**
   * A national identity number, where the scheme wants one up front.
   *
   * Swedish BankID can be started without a personnummer (the user picks the device); MitID
   * generally cannot. Optional here so neither is forced to invent one.
   */
  nationalId?: string;
  /** BCP-47. The signing page should open in the party's language, not the sender's. */
  locale: string;
}

export interface SigningRequest {
  documentName: string;
  document: Buffer;
  contentType: string;
  parties: SigningParty[];
  /** Where the party is sent when they finish. The provider appends its own parameters. */
  returnUrl?: string;
  /** Retries must not create a second signing request against the same document. */
  idempotencyKey?: string;
}

export interface SigningSession {
  /** The provider's own identifier, which is what every later call is made with. */
  reference: string;
  /** Per party, by `SigningParty.id`. Empty for a provider that emails its own invitations. */
  signUrls: Record<string, string>;
  status: SigningStatus;
}

export interface SigningEvidence {
  kind: SigningKind;
  /** Provider name plus scheme, e.g. `scrive` or `bankid-se`. Recorded verbatim. */
  method: string;
  signedAt: string;
  /**
   * What the scheme said about the signer, as it said it.
   *
   * Deliberately loose: a BankID completion carries a personnummer, a name and a device record;
   * Scrive carries an evidence-log id. Normalising those into common columns would throw away the
   * part an auditor actually asks for.
   */
  details: Record<string, string>;
}

export interface SigningResult {
  reference: string;
  status: SigningStatus;
  /** Present only once `status` is `signed`. */
  evidence?: SigningEvidence;
}

export interface SigningProvider {
  readonly name: string;
  readonly kind: SigningKind;
  start(request: SigningRequest): Promise<SigningSession>;
  status(reference: string): Promise<SigningResult>;
  /** The sealed document, for an agreement service. Identity schemes return nothing to fetch. */
  fetchSigned?(reference: string): Promise<Buffer>;
}

/**
 * Signs everything, immediately, and says so in the log.
 *
 * The counterpart to the console mail provider: it lets the signing flow be built end to end
 * before an account exists anywhere. `method` says `console` rather than borrowing a real scheme's
 * name, so a demo database can never be mistaken for one holding real signatures.
 */
export function createConsoleSigningProvider(log: (message: string) => void): SigningProvider {
  const sessions = new Map<string, SigningResult>();

  return {
    name: 'console',
    kind: 'drawn',
    async start(request) {
      const reference = `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      log(
        `\n--- signing (console provider) ---\n` +
          `document: ${request.documentName} (${request.document.byteLength} bytes)\n` +
          `parties: ${request.parties.map((party) => party.name).join(', ')}\n` +
          `NOT A REAL SIGNATURE\n---\n`,
      );
      sessions.set(reference, {
        reference,
        status: 'signed',
        evidence: {
          kind: 'drawn',
          method: 'console',
          signedAt: new Date().toISOString(),
          details: { note: 'Console provider. No identity was verified.' },
        },
      });
      return {
        reference,
        // No hosted page to send anyone to, so no URLs rather than a fabricated one.
        signUrls: {},
        status: 'signed',
      };
    },
    async status(reference) {
      return sessions.get(reference) ?? { reference, status: 'failed' };
    },
  };
}

/** Refuses everything, loudly, so a missing configuration is never a silent no-op. */
export function createUnconfiguredSigningProvider(): SigningProvider {
  return {
    name: 'unconfigured',
    kind: 'drawn',
    async start() {
      throw new Error(
        'No signing provider is configured. Set SIGNING_PROVIDER=console for development; ' +
          'a real provider needs an account or a merchant agreement.',
      );
    },
    async status() {
      throw new Error('No signing provider is configured.');
    },
  };
}
