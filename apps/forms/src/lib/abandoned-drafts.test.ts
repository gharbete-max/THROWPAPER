import { describe, expect, it } from 'vitest';
import { emptyDefinition, type FormResponse } from '@tp/shared/forms';
import { abandonedDrafts } from './abandoned-drafts.js';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const ME = '11111111-1111-4111-8111-111111111111';

function form(overrides: Partial<FormResponse> = {}): FormResponse {
  return {
    id: crypto.randomUUID(),
    slug: 'form-mgx3k2a',
    title: { 'en-GB': 'Untitled form' },
    eventId: null,
    status: 'draft',
    opensAt: null,
    closesAt: null,
    draftDefinition: emptyDefinition,
    publishedVersion: null,
    submissionCount: 0,
    completeness: [],
    problems: [],
    ownerUserId: ME,
    ownerName: 'Me',
    deletedAt: null,
    access: 'owner',
    sharedRole: null,
    shareCount: 0,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    ...overrides,
  } as FormResponse;
}

describe('which drafts were started and never answered', () => {
  it('takes my empty, unpublished, unanswered draft that is more than a day old', () => {
    const old = form();
    expect(abandonedDrafts([old], ME, NOW)).toEqual([old]);
  });

  it('leaves alone a draft from the last day, one with anything in it, and anything with a history', () => {
    const fresh = form({ updatedAt: '2026-10-21T08:00:00.000Z' });
    const written = form({
      draftDefinition: {
        ...emptyDefinition,
        settings: { ...emptyDefinition.settings, showProgress: false },
      },
    });
    const published = form({ publishedVersion: 1, status: 'published' });
    const answered = form({ submissionCount: 3 });
    const shared = form({ shareCount: 1 });
    const hers = form({ ownerUserId: '22222222-2222-4222-8222-222222222222' });
    const named = form({ slug: 'summer-party' });
    const inEvent = form({ eventId: '33333333-3333-4333-8333-333333333333' });
    const binned = form({ deletedAt: '2026-10-20T08:00:00.000Z' });
    expect(
      abandonedDrafts(
        [fresh, written, published, answered, shared, hers, named, inEvent, binned],
        ME,
        NOW,
      ),
    ).toEqual([]);
  });

  it('counts a day as twenty-four hours, to the millisecond', () => {
    const edge = form({ updatedAt: new Date(NOW - 24 * 3600 * 1000).toISOString() });
    const inside = form({ updatedAt: new Date(NOW - 24 * 3600 * 1000 + 1).toISOString() });
    expect(abandonedDrafts([edge, inside], ME, NOW)).toEqual([edge]);
  });
});
