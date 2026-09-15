import { ZipArchive } from 'archiver';
import { forms as formSchemas } from '@tp/shared';
import type { Repositories, SubmissionRecord } from '../db/repositories/index.js';
import type { DocumentStore } from './store.js';
import type { PdfRenderer } from './render.js';
import { attendeeName, renderAdmissionHtml } from './admission.js';
import { resolveTokens } from '../routes/brand-kit.js';
import { deriveQrKey, signAdmissionToken } from './qr-token.js';
import type { JobContext, JobHandler } from '../jobs/worker.js';
import { definitionsByVersion, partyOf, type PartyMember } from '../checkin/party.js';

const { entryReference, REGISTRANT_ENTRY } = formSchemas;

export const ADMISSION_BULK_JOB = 'admission.bulk';

export interface AdmissionDeps {
  repos: Repositories;
  renderer: PdfRenderer;
  store: DocumentStore;
  /** Master secret; the QR key is derived from it, never used directly. */
  jwtSecret: string;
}

/**
 * One admission PDF — for one **person**. Shared by the single-document route and the bulk job.
 *
 * `member` says whose card: the registrant by default, or one of the guests they brought. The
 * token signs that person's own reference (`ABCD-EFGH:2`), so each card in a party has a distinct
 * signature bound to that guest and that event, and forging one from another means forging an
 * HMAC. See `docs/adr/0003-repeating-groups.md`.
 */
export async function renderAdmissionPdf(
  deps: AdmissionDeps,
  organisationId: string,
  submission: SubmissionRecord,
  member: PartyMember = { entryIndex: REGISTRANT_ENTRY, guestName: null },
): Promise<{ pdf: Buffer; filename: string; token: string } | null> {
  if (!submission.eventId) return null;

  const organisation = await deps.repos.organisations.findById(organisationId);
  const event = await deps.repos.events.findById(organisationId, submission.eventId);
  if (!organisation || !event) return null;

  const cardReference = entryReference(submission.reference, member.entryIndex);

  const token = signAdmissionToken(
    { reference: cardReference, eventId: event.id },
    deriveQrKey(deps.jwtSecret),
  );

  const { tokens } = await resolveTokens(deps.repos, organisationId);
  const html = await renderAdmissionHtml({
    organisation,
    event,
    submission,
    token,
    tokens,
    entryIndex: member.entryIndex,
    guestName: member.guestName,
  });
  const pdf = await deps.renderer.render(html, {
    header: organisation.name,
    footer: cardReference,
  });

  const named =
    member.entryIndex === REGISTRANT_ENTRY
      ? attendeeName(submission.data)
      : (member.guestName ?? '');

  /*
   * `:` is forbidden in a filename on Windows and `safeName` strips it, which would turn
   * `ABCD-EFGH:2` into `ABCD-EFGH2` — a name that reads like a different reference. A hyphen says
   * the same thing and survives every filesystem, and inside a ZIP of one event's cards the
   * ordinal only has to be distinguishable, not parseable.
   */
  const stem =
    member.entryIndex === REGISTRANT_ENTRY
      ? submission.reference
      : `${submission.reference}-${member.entryIndex}`;

  return { pdf, token, filename: `${safeName(named)}-${safeName(stem)}.pdf` };
}

/**
 * Bulk generation as a background job — START-HERE §In scope, and `SPEC-forms.md` §5: "a ZIP of
 * individual PDFs" with progress and a download when ready.
 *
 * One failing document does not lose the rest: it is recorded and the run continues. A bulk job
 * that aborts at row 137 of 200 is worse than useless to an operator with an event tomorrow.
 */
export function createAdmissionBulkHandler(deps: AdmissionDeps): JobHandler {
  return async ({ job, progress }: JobContext) => {
    const formId = String(job.payload['formId'] ?? '');
    const submissions = (await deps.repos.submissions.list(job.organisationId, formId)).filter(
      (submission) => submission.status === 'complete' && submission.eventId,
    );

    /**
     * One card per **person**, so a run produces more documents than there are rows.
     *
     * Which means the progress count is of cards rather than of registrations — an operator
     * watching "142 of 200" while 260 cards are being written would be watching a number that
     * cannot reach its total.
     */
    const definitions = await definitionsByVersion(
      deps.repos,
      submissions.map((submission) => submission.formId),
    );
    const cards = submissions.flatMap((submission) =>
      partyOf(definitions.get(submission.formVersionId), submission).map((member) => ({
        submission,
        member,
      })),
    );

    // archiver v8 exports classes rather than the old callable factory.
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const failures: string[] = [];
    let done = 0;

    for (const { submission, member } of cards) {
      const cardReference = entryReference(submission.reference, member.entryIndex);
      try {
        const rendered = await renderAdmissionPdf(deps, job.organisationId, submission, member);
        if (rendered) archive.append(rendered.pdf, { name: rendered.filename });
        else failures.push(cardReference);
      } catch (error) {
        failures.push(cardReference);
        // Recorded on the job rather than thrown: see the note above.
        deps.repos.audit
          .record({
            organisationId: job.organisationId,
            actorUserId: null,
            action: 'admission.render_failed',
            entityType: 'submission',
            entityId: submission.id,
            after: { error: error instanceof Error ? error.message : String(error) },
          })
          .catch(() => undefined);
      }

      done += 1;
      if (done % 10 === 0 || done === cards.length) await progress(done);
    }

    await archive.finalize();
    await finished;

    const stored = await deps.store.put(
      `admission-${formId}.zip`,
      Buffer.concat(chunks as unknown as Uint8Array[]),
    );

    return {
      key: stored.key,
      bytes: stored.bytes,
      generated: cards.length - failures.length,
      failed: failures.length,
      failedReferences: failures.slice(0, 50),
      downloadPath: deps.store.signedPath(stored.key),
    };
  };
}

/** A filename that survives a ZIP on Windows, macOS and Linux without mangling å ä ö. */
function safeName(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return cleaned || 'attendee';
}
