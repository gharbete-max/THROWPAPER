import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  TEST_JWT_SECRET,
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';
import { deriveQrKey, signAdmissionToken } from '../documents/qr-token.js';
import { renderAdmissionHtml } from '../documents/admission.js';
import { attendanceOf, partySizeOf } from './service.js';
import { guestsOf, partyOf } from './party.js';

/**
 * A guest gets their own admission card — ADR 0003's amendment.
 *
 * The three questions that ADR named as needing answers before this could be built are the three
 * things this file holds to: a per-entry identity that does not disturb the unique reference
 * index, a per-entry QR, and what the door does when the member arrives and the guest does not.
 */

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

const guestGroup = {
  id: 'g1',
  key: 'guests',
  type: 'repeating_group' as const,
  label: { 'sv-SE': 'Gäster', 'en-GB': 'Guests' },
  max: 3,
  admits: true,
  admitNameKey: 'guest_name',
  fields: [
    {
      id: 'c1',
      key: 'guest_name',
      type: 'short_text' as const,
      label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
      required: true,
    },
  ],
};

const fields = [
  {
    id: 'f1',
    key: 'full_name',
    type: 'short_text' as const,
    label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
    required: true,
  },
  guestGroup,
];

/** One event, one form with a guests group, and one registration bringing `guests` people. */
async function setupWithGuests(guests: string[], slug = 'arsmote') {
  const event = await harness.app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: bearer(adminToken),
    payload: {
      name: { 'sv-SE': 'Årsmötet', 'en-GB': 'AGM' },
      startsAt: '2027-05-14T09:00:00.000Z',
      endsAt: '2027-05-14T16:00:00.000Z',
      status: 'open',
    },
  });
  const eventId = event.json().id as string;

  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug, title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
  });
  const formId = created.json().id as string;

  await harness.app.inject({
    method: 'PATCH',
    url: `/v1/forms/${formId}`,
    headers: bearer(adminToken),
    payload: { eventId },
  });
  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${formId}/draft`,
    headers: bearer(adminToken),
    payload: { definition: { ...formSchemas.emptyDefinition, fields } },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${formId}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: false },
  });

  const submitted = await harness.app.inject({
    method: 'POST',
    url: `/public/forms/${slug}`,
    payload: {
      locale: 'sv-SE',
      values: {
        full_name: 'Alva Öberg',
        guests: guests.map((name) => ({ guest_name: name })),
      },
    },
  });
  expect(submitted.statusCode).toBeLessThan(300);

  const submission = harness.state.submissions.at(-1)!;
  return { eventId, formId, submission };
}

function scan(eventId: string, code: string, token = operatorToken) {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/events/${eventId}/check-ins`,
    headers: bearer(token),
    payload: { code },
  });
}

function tokenFor(reference: string, eventId: string) {
  return signAdmissionToken({ reference, eventId }, deriveQrKey(TEST_JWT_SECRET));
}

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('a guest has an identity, and it is derived', () => {
  it('stores no row for a guest — the reference index is untouched', async () => {
    const { submission } = await setupWithGuests(['Björn', 'Cecilia']);
    expect(harness.state.submissions).toHaveLength(1);
    expect(submission.reference).not.toContain(':');
  });

  it('reads the guests off the registration in order', async () => {
    const { submission, formId } = await setupWithGuests(['Björn', 'Cecilia']);
    const version = harness.state.formVersions.find((v) => v.formId === formId)!;

    expect(guestsOf(version.definition, submission)).toEqual([
      { entryIndex: 1, guestName: 'Björn' },
      { entryIndex: 2, guestName: 'Cecilia' },
    ]);
    expect(partyOf(version.definition, submission)).toHaveLength(3);
    expect(partySizeOf(version.definition, submission)).toBe(3);
  });

  /**
   * `admits` is what makes a block a queue of people, and it is off by default.
   *
   * The same submission, the same two entries, read against the same block with the flag turned
   * off: one person. A group of meter readings is not a party, and turning every repeating block
   * into a stack of tickets would give the feature a second meaning nobody asked it for.
   */
  it('counts one when the block admits nobody, however many entries it holds', async () => {
    const { submission } = await setupWithGuests(['Björn', 'Cecilia']);

    const admitting = formSchemas.FormDefinition.parse({
      ...formSchemas.emptyDefinition,
      fields: [guestGroup],
    });
    const silent = formSchemas.FormDefinition.parse({
      ...formSchemas.emptyDefinition,
      fields: [{ ...guestGroup, admits: false }],
    });

    expect(partySizeOf(admitting, submission)).toBe(3);
    expect(partySizeOf(silent, submission)).toBe(1);
  });

  it('counts one for a form with no block at all', async () => {
    const { submission } = await setupWithGuests(['Björn']);
    expect(partySizeOf(formSchemas.emptyDefinition, submission)).toBe(1);
  });
});

describe('the door', () => {
  it('admits a guest on their own card', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    const response = await scan(eventId, tokenFor(`${submission.reference}:1`, eventId));

    expect(response.json().outcome).toBe('admitted');
    expect(response.json().attendee.name).toBe('Björn');
    expect(response.json().attendee.broughtBy).toBe('Alva Öberg');
    expect(response.json().attendee.reference).toBe(`${submission.reference}:1`);
    expect(response.json().attendee.entryIndex).toBe(1);
  });

  /**
   * The question ADR 0003 said had to be answered before this could be built.
   *
   * Each card is admitted on its own. A party admitted by one scan is a party the fire officer
   * cannot account for.
   */
  it('does not admit the guest when the member arrives', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    await scan(eventId, tokenFor(submission.reference, eventId));

    expect(harness.state.checkIns).toHaveLength(1);
    expect(harness.state.checkIns[0]?.entryIndex).toBe(0);

    const attendance = await harness.app.inject({
      method: 'GET',
      url: `/v1/events/${eventId}/attendance`,
      headers: bearer(operatorToken),
    });
    expect(attendance.json().checkedIn).toBe(1);
    expect(attendance.json().noShow).toBe(1);
  });

  it('does not admit the member when the guest arrives', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    await scan(eventId, tokenFor(`${submission.reference}:1`, eventId));

    expect(harness.state.checkIns).toHaveLength(1);
    expect(harness.state.checkIns[0]?.entryIndex).toBe(1);
  });

  it('is idempotent per card, not per registration', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);
    const card = tokenFor(`${submission.reference}:1`, eventId);

    expect((await scan(eventId, card)).json().outcome).toBe('admitted');
    expect((await scan(eventId, card)).json().outcome).toBe('already');
    expect((await scan(eventId, tokenFor(submission.reference, eventId))).json().outcome).toBe(
      'admitted',
    );

    expect(harness.state.checkIns).toHaveLength(2);
  });

  it('accepts a guest reference typed by hand', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);
    const response = await scan(eventId, `${submission.reference}:1`.toLowerCase());
    expect(response.json().outcome).toBe('admitted');
    expect(harness.state.checkIns[0]?.method).toBe('manual');
  });

  /** A guest has no registration of their own to survive. */
  it('refuses a guest card when the registration is revoked', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    await harness.app.inject({
      method: 'POST',
      url: `/v1/submissions/${submission.id}/revoke`,
      headers: bearer(adminToken),
    });

    const response = await scan(eventId, tokenFor(`${submission.reference}:1`, eventId));
    expect(response.json().outcome).toBe('revoked');
    expect(harness.state.checkIns).toHaveLength(0);
  });

  /**
   * The signature proves the card was issued. It does not prove the answers still say so.
   */
  it('refuses an ordinal the registration no longer has, and says whose it was', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    const response = await scan(eventId, tokenFor(`${submission.reference}:3`, eventId));
    expect(response.json().outcome).toBe('no-such-guest');
    // The registration is real, so the door can see who it belongs to and help.
    expect(response.json().attendee.submissionId).toBe(submission.id);
  });

  it('refuses a guest card signed for a different ordinal', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn', 'Cecilia']);

    // The signature covers the whole reference, ordinal included, so one card cannot become another.
    const forged = `${submission.reference}:2.${tokenFor(`${submission.reference}:1`, eventId).split('.')[1]}`;
    expect((await scan(eventId, forged)).json().outcome).toBe('bad-signature');
  });

  it('refuses an ordinal above anything a group could hold', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);
    expect((await scan(eventId, `${submission.reference}:99`)).json().outcome).toBe('not-found');
  });
});

describe('undoing', () => {
  it('takes back one card, leaving the rest of the party where they are', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    await scan(eventId, tokenFor(submission.reference, eventId));
    await scan(eventId, tokenFor(`${submission.reference}:1`, eventId));
    expect(harness.state.checkIns).toHaveLength(2);

    const undone = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/events/${eventId}/check-ins/${submission.id}?entry=1`,
      headers: bearer(operatorToken),
    });

    expect(undone.statusCode).toBe(204);
    expect(harness.state.checkIns).toHaveLength(1);
    expect(harness.state.checkIns[0]?.entryIndex).toBe(0);
  });

  it('defaults to the registrant, so a caller that knows nothing of guests still works', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn']);

    await scan(eventId, tokenFor(submission.reference, eventId));
    await scan(eventId, tokenFor(`${submission.reference}:1`, eventId));

    await harness.app.inject({
      method: 'DELETE',
      url: `/v1/events/${eventId}/check-ins/${submission.id}`,
      headers: bearer(operatorToken),
    });

    expect(harness.state.checkIns.map((c) => c.entryIndex)).toEqual([1]);
  });
});

describe('attendance counts people', () => {
  it('reports the party, and the registrations behind it', async () => {
    const { eventId } = await setupWithGuests(['Björn', 'Cecilia']);

    const attendance = await harness.app.inject({
      method: 'GET',
      url: `/v1/events/${eventId}/attendance`,
      headers: bearer(operatorToken),
    });

    expect(attendance.json().registered).toBe(3);
    expect(attendance.json().registrations).toBe(1);
    expect(attendance.json().noShow).toBe(3);
  });

  it('lists each guest after whoever brought them', async () => {
    const { eventId, submission } = await setupWithGuests(['Björn', 'Cecilia']);

    const attendance = await harness.app.inject({
      method: 'GET',
      url: `/v1/events/${eventId}/attendance`,
      headers: bearer(operatorToken),
    });

    expect(attendance.json().attendees.map((a: { reference: string }) => a.reference)).toEqual([
      submission.reference,
      `${submission.reference}:1`,
      `${submission.reference}:2`,
    ]);
    expect(attendance.json().attendees.map((a: { name: string }) => a.name)).toEqual([
      'Alva Öberg',
      'Björn',
      'Cecilia',
    ]);
  });

  /** A withdrawn registration withdraws the people it brought, so none of them is a no-show. */
  it('does not count a revoked party as no-shows', () => {
    const rows = [
      { status: 'complete', revokedAt: new Date(), data: {} },
      { status: 'complete', revokedAt: null, data: {} },
    ] as unknown as Parameters<typeof attendanceOf>[0];

    const attendance = attendanceOf(rows, [], () => 3);
    expect(attendance.registered).toBe(6);
    expect(attendance.revoked).toBe(3);
    expect(attendance.noShow).toBe(3);
  });

  it('counts one per row when nothing says otherwise', () => {
    const rows = [{ status: 'complete', revokedAt: null, data: {} }] as unknown as Parameters<
      typeof attendanceOf
    >[0];
    expect(attendanceOf(rows, []).registered).toBe(1);
  });
});

describe('the card', () => {
  /** The submission always carries the plain reference; the ordinal is the renderer's to add. */
  const REFERENCE = 'ABCD-EFGH';

  async function card(entryIndex: number, guestName: string | null) {
    const { submission } = await setupWithGuests(['Björn']);
    return renderAdmissionHtml({
      organisation: harness.state.organisations[0]!,
      event: harness.state.events[0]!,
      submission: { ...submission, reference: REFERENCE },
      token: tokenFor(`${REFERENCE}:${entryIndex}`, harness.state.events[0]!.id),
      entryIndex,
      guestName,
    });
  }

  it("prints the guest's own reference and name, and who brought them", async () => {
    const html = await card(1, 'Björn');
    expect(html).toContain('<dd>ABCD-EFGH:1</dd>');
    expect(html).toContain('<dd>Björn</dd>');
    expect(html).toContain('<dd>Alva Öberg</dd>');
    // Swedish, because the card is in the attendee's language, not the organisation's.
    expect(html).toContain('Gäst hos');
    expect(html).toContain('Gästkort');
  });

  it("leaves the registrant's card exactly as it was", async () => {
    const html = await card(0, null);
    expect(html).toContain('<dd>ABCD-EFGH</dd>');
    expect(html).not.toContain('ABCD-EFGH:');
    expect(html).toContain('Inträdeskort');
    expect(html).not.toContain('Gäst hos');
  });

  /** A dash, not the member's name: one named card and one obviously blank beats two identical. */
  it('shows an unnamed guest as blank rather than borrowing a name', async () => {
    const html = await card(2, null);
    expect(html).toContain('<dd>—</dd>');
    expect(html).toContain('<dd>ABCD-EFGH:2</dd>');
    // The member's name appears once, as who brought them — never as the guest.
    expect(html.match(/Alva Öberg/g)).toHaveLength(1);
  });
});
