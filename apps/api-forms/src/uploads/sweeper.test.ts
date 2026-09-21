import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import { createTestHarness, testOrganisation, type TestHarness } from '../test-support.js';
import type { FormRecord, UploadRecord } from '../db/repositories/types.js';
import { sweepExpiredUploads, UPLOAD_CLAIM_WINDOW_SECONDS } from './lifecycle.js';

/**
 * Somebody attaches a CV and closes the tab. The bytes stay; the row says when they arrived and
 * that nothing claimed them. This is the thing that finally reads that row.
 *
 * The threshold is not a retention decision made here. A saved-and-resumed draft can still claim
 * its upload for as long as the resume link lives (`RESUME_TTL_SECONDS`), and nothing else can
 * claim one later than that — so "unclaimed for longer than the resume window" is the one cutoff
 * the code already commits to, and the submit path refuses to claim past the same window, which
 * is what makes the sweep safe against a claim: they never want the same row.
 *
 * Bytes are shared. The store is content-addressed, so one file may back several rows, and a form
 * imported from paper keeps its pages in the same store with no row at all. A file goes only when
 * nothing names its key any more.
 */
const NOW = new Date('2026-09-21T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const KEY_A = `${'a'.repeat(64)}.pdf`;
const KEY_B = `${'b'.repeat(64)}.pdf`;
const KEY_C = `${'c'.repeat(64)}.pdf`;
const KEY_D = `${'d'.repeat(64)}.pdf`;
const KEY_PAPER = `${'e'.repeat(64)}.pdf`;

const FORM: FormRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  organisationId: testOrganisation.id,
  eventId: null,
  slug: 'with-paper',
  title: { 'sv-SE': 'Anmälan' },
  status: 'draft',
  draftDefinition: {
    ...formSchemas.emptyDefinition,
    paper: { sources: [{ key: KEY_PAPER, pages: 1 }] },
  },
  publishedVersionId: null,
  publishedVersion: 0,
  opensAt: null,
  closesAt: null,
  ownerUserId: null,
  deletedAt: null,
  createdAt: ago(60),
  updatedAt: ago(60),
};

let n = 0;
function upload(key: string, createdAt: Date, submissionId: string | null = null): UploadRecord {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    organisationId: testOrganisation.id,
    formId: FORM.id,
    storageKey: key,
    filename: 'cv.pdf',
    contentType: 'application/pdf',
    bytes: 3,
    submissionId,
    createdAt,
  };
}

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness({ forms: [FORM] });
});

afterEach(async () => {
  await harness.close();
});

function seed(...uploads: UploadRecord[]) {
  for (const record of uploads) {
    harness.state.uploads.push(record);
    harness.uploadStore.files.set(record.storageKey, Buffer.from('PDF'));
  }
}

const sweep = (limit = 100) =>
  sweepExpiredUploads(
    { repos: harness.repos, uploadStore: harness.uploadStore },
    { now: NOW, limit },
  );

const rows = () => harness.state.uploads.map((upload) => upload.storageKey).sort();
const files = () => [...harness.uploadStore.files.keys()].sort();

describe('the sweep', () => {
  it('removes an anonymous upload nobody claimed within the window', async () => {
    seed(upload(KEY_A, ago(31)));

    expect(await sweep()).toEqual({ rowsDeleted: 1, filesDeleted: 1, filesKept: 0 });
    expect(rows()).toEqual([]);
    expect(files()).toEqual([]);
  });

  it('leaves a newer one alone', async () => {
    seed(upload(KEY_A, ago(31)), upload(KEY_B, ago(1)));

    await sweep();
    expect(rows()).toEqual([KEY_B]);
    expect(files()).toEqual([KEY_B]);
  });

  it('leaves a claimed one alone, however old', async () => {
    seed(upload(KEY_C, ago(400), '77777777-7777-4777-8777-777777777777'));

    expect(await sweep()).toEqual({ rowsDeleted: 0, filesDeleted: 0, filesKept: 0 });
    expect(rows()).toEqual([KEY_C]);
    expect(files()).toEqual([KEY_C]);
  });

  it('drops the row but keeps the bytes when a claimed upload shares them', async () => {
    seed(upload(KEY_A, ago(31)), upload(KEY_A, ago(10), '77777777-7777-4777-8777-777777777777'));

    expect(await sweep()).toEqual({ rowsDeleted: 1, filesDeleted: 0, filesKept: 1 });
    expect(rows()).toEqual([KEY_A]);
    expect(files()).toEqual([KEY_A]);
  });

  it('keeps the bytes when a form still has them as its paper', async () => {
    seed(upload(KEY_PAPER, ago(31)));

    expect(await sweep()).toEqual({ rowsDeleted: 1, filesDeleted: 0, filesKept: 1 });
    expect(rows()).toEqual([]);
    expect(files()).toEqual([KEY_PAPER]);
  });

  it('is harmless to run again', async () => {
    seed(upload(KEY_A, ago(31)), upload(KEY_B, ago(1)));

    await sweep();
    expect(await sweep()).toEqual({ rowsDeleted: 0, filesDeleted: 0, filesKept: 0 });
    expect(rows()).toEqual([KEY_B]);
    expect(files()).toEqual([KEY_B]);
  });

  it('takes at most the limit per run, oldest first', async () => {
    seed(upload(KEY_A, ago(40)), upload(KEY_D, ago(31)));

    expect(await sweep(1)).toEqual({ rowsDeleted: 1, filesDeleted: 1, filesKept: 0 });
    expect(rows()).toEqual([KEY_D]);
    expect(await sweep(1)).toEqual({ rowsDeleted: 1, filesDeleted: 1, filesKept: 0 });
    expect(rows()).toEqual([]);
  });

  it('cuts exactly at the resume window, so it and the claim never want the same row', () => {
    expect(UPLOAD_CLAIM_WINDOW_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});
