import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  adminUser,
  bearer,
  createTestHarness,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';

/**
 * The one route in the product where a stranger can cause bytes to be written to disk, and the
 * one where somebody's CV can be read back. These are the checks that make both safe.
 */
let harness: TestHarness;
let adminToken: string;

const SLUG = 'attachments';

/** A minimal real PNG header, so the sniffing accepts it for the right reason. */
const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\n'), Buffer.alloc(32)]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);

function multipart(content: Buffer, filename = 'cv.pdf') {
  const boundary = '----formworktest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** A published, open form with one required-ish file question. */
async function seedForm(accept: 'image' | 'pdf' | 'both' = 'both') {
  const definition = formSchemas.FormDefinition.parse({
    schemaVersion: 1,
    fields: [
      {
        id: 'f1',
        key: 'attachment',
        type: 'file',
        label: { 'sv-SE': 'Bilaga', 'en-GB': 'Attachment' },
        accept,
      },
    ],
  });

  const form = await harness.repos.forms.create({
    organisationId: testOrganisation.id,
    eventId: null,
    slug: SLUG,
    title: { 'sv-SE': 'Bilagor', 'en-GB': 'Attachments' },
    status: 'published',
    draftDefinition: definition,
    opensAt: null,
    closesAt: null,
  });
  const version = await harness.repos.forms.createVersion({
    formId: form.id,
    definition,
    translationOverride: false,
  });
  // `loadPublished` resolves the live definition by version *id*, not by number.
  await harness.repos.forms.update(testOrganisation.id, form.id, {
    publishedVersion: 1,
    publishedVersionId: version.id,
  });
  return { form, version };
}

const upload = (content: Buffer, filename?: string, field = 'attachment') =>
  harness.app.inject({
    method: 'POST',
    url: `/public/forms/${SLUG}/uploads?field=${field}`,
    ...multipart(content, filename),
  });

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  await seedForm();
});

afterEach(async () => {
  await harness.close();
});

describe('attaching a file', () => {
  it('stores it and hands back a key that is the hash of the content', async () => {
    const response = await upload(pdf);
    expect(response.statusCode).toBe(201);
    const body = response.json() as { key: string; filename: string; contentType: string };
    expect(body.key).toMatch(/^[0-9a-f]{64}\.pdf$/);
    expect(body.contentType).toBe('application/pdf');
    // The filename is kept for display, and is never what the file is stored as.
    expect(body.filename).toBe('cv.pdf');
    expect(harness.uploadStore.files.has(body.key)).toBe(true);
  });

  it('refuses a file for a question that does not exist', async () => {
    // Otherwise a published form would be a drop box for anything anybody posted at it.
    const response = await upload(pdf, 'cv.pdf', 'no_such_question');
    expect(response.statusCode).toBe(400);
  });

  it('refuses a kind the question did not ask for', async () => {
    await harness.close();
    harness = await createTestHarness();
    adminToken = (await signIn(harness, adminUser.email)).accessToken;
    await seedForm('image');

    expect((await upload(pdf)).statusCode).toBe(400);
    expect((await upload(png, 'photo.png')).statusCode).toBe(201);
  });

  it('refuses HTML dressed as a PDF', async () => {
    const response = await upload(Buffer.from('<html><script>alert(1)</script>'), 'cv.pdf');
    expect(response.statusCode).toBe(400);
  });

  it('leaves the upload unclaimed until a submission takes it', async () => {
    const { key } = (await upload(pdf)).json() as { key: string };
    const stored = harness.state.uploads.find((entry) => entry.storageKey === key);
    // Null is what makes an abandoned upload findable later.
    expect(stored?.submissionId).toBeNull();
  });
});

describe('submitting with an attachment', () => {
  const submit = (values: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: `/public/forms/${SLUG}`,
      payload: { locale: 'sv-SE', values, website: '' },
    });

  it('accepts a key this form actually received', async () => {
    const { key } = (await upload(pdf)).json() as { key: string };
    const response = await submit({ attachment: key });
    expect(response.statusCode).toBe(201);

    const stored = harness.state.uploads.find((entry) => entry.storageKey === key);
    expect(stored?.submissionId).not.toBeNull();
  });

  /**
   * A storage key is the SHA-256 of the content, so anybody holding the same file can work one
   * out. "The answer names a real upload" is therefore not a check at all — being an upload *this
   * form* received, that nothing has claimed, is.
   */
  it('refuses a key that looks right but this form never received', async () => {
    const invented = `${'a'.repeat(64)}.pdf`;
    const response = await submit({ attachment: invented });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { issues: Array<{ key: string }> }).issues).toEqual([
      { key: 'attachment', code: 'validation.file' },
    ]);
  });

  it('refuses a key a previous submission already used', async () => {
    const { key } = (await upload(pdf)).json() as { key: string };
    expect((await submit({ attachment: key })).statusCode).toBe(201);
    // The second attempt cannot re-attach somebody else's file by quoting its key.
    expect((await submit({ attachment: key })).statusCode).toBe(422);
  });

  it('refuses something that is not a key at all', async () => {
    expect((await submit({ attachment: '../../etc/passwd' })).statusCode).toBe(422);
  });
});

describe('reading a file back', () => {
  async function submittedUpload() {
    const { key } = (await upload(pdf)).json() as { key: string };
    await harness.app.inject({
      method: 'POST',
      url: `/public/forms/${SLUG}`,
      payload: { locale: 'sv-SE', values: { attachment: key }, website: '' },
    });
    const stored = harness.state.uploads.find((entry) => entry.storageKey === key)!;
    return { key, submissionId: stored.submissionId! };
  }

  it('needs a signed-in operator', async () => {
    const { key, submissionId } = await submittedUpload();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/files/${key}`,
    });
    // Never a public URL, however unguessable — a link gets forwarded, logged and pasted.
    expect(response.statusCode).toBe(401);
  });

  it('serves it to somebody signed in to the organisation that asked for it', async () => {
    const { key, submissionId } = await submittedUpload();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/files/${key}`,
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    // Always an attachment: nothing a stranger uploaded renders inline on this origin.
    expect(String(response.headers['content-disposition'])).toContain('attachment;');
    expect(Buffer.from(response.rawPayload).equals(pdf)).toBe(true);
  });

  it('will not serve a file against a submission it does not belong to', async () => {
    const { key } = await submittedUpload();
    const elsewhere = '00000000-0000-4000-8000-000000000000';
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${elsewhere}/files/${key}`,
      headers: bearer(adminToken),
    });
    // The key alone proves nothing; the row tying it to a submission is the access control.
    expect(response.statusCode).toBe(404);
  });

  it('refuses a key shaped like a path', async () => {
    const { submissionId } = await submittedUpload();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/files/${encodeURIComponent('../../secret')}`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(404);
  });
});

/**
 * A signature goes through the same route as a file, deliberately.
 *
 * Every check on that surface — the form must be open, the bytes decide the format, the key is
 * the content hash, the row starts unclaimed — then applies to signatures without anybody having
 * to remember to copy it across. What differs is only the limits.
 */
describe('signing', () => {
  async function seedSignatureForm() {
    const definition = formSchemas.FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 's1',
          key: 'signed_by',
          type: 'signature',
          label: { 'sv-SE': 'Signatur', 'en-GB': 'Signature' },
        },
      ],
    });

    const form = await harness.repos.forms.create({
      organisationId: testOrganisation.id,
      eventId: null,
      slug: 'contract',
      title: { 'sv-SE': 'Avtal', 'en-GB': 'Contract' },
      status: 'published',
      draftDefinition: definition,
      opensAt: null,
      closesAt: null,
    });
    const version = await harness.repos.forms.createVersion({
      formId: form.id,
      definition,
      translationOverride: false,
    });
    await harness.repos.forms.update(testOrganisation.id, form.id, {
      publishedVersion: 1,
      publishedVersionId: version.id,
    });
    return form;
  }

  const signWith = (content: Buffer) =>
    harness.app.inject({
      method: 'POST',
      url: '/public/forms/contract/uploads?field=signed_by',
      ...multipart(content, 'signature.png'),
    });

  it('accepts the PNG the pad produces', async () => {
    await seedSignatureForm();
    const response = await signWith(png);
    expect(response.statusCode).toBe(201);
    expect((response.json() as { key: string }).key).toMatch(/^[0-9a-f]{64}.png$/);
  });

  it('refuses a PDF, because a signature is an image this app drew', async () => {
    await seedSignatureForm();
    expect((await signWith(pdf)).statusCode).toBe(400);
  });

  it('claims the signature when the form is submitted', async () => {
    await seedSignatureForm();
    const { key } = (await signWith(png)).json() as { key: string };

    const submitted = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/contract',
      payload: { locale: 'sv-SE', values: { signed_by: key }, website: '' },
    });
    expect(submitted.statusCode).toBe(201);

    const stored = harness.state.uploads.find((entry) => entry.storageKey === key);
    // Without the claim covering signatures they would look abandoned for ever and be swept up.
    expect(stored?.submissionId).not.toBeNull();
  });

  it('refuses a signature key this form never issued', async () => {
    await seedSignatureForm();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/contract',
      payload: { locale: 'sv-SE', values: { signed_by: `${'b'.repeat(64)}.png` }, website: '' },
    });
    expect(response.statusCode).toBe(422);
  });
});
