import { describe, expect, it } from 'vitest';
import { finishedState, readFinished } from './finished-state.js';

const finished = {
  reference: 'K7M2-QX4A',
  confirmation: 'Tack!',
  coming: { email: 'asa@example.com', card: false },
  document: { token: 'id.123.mac', filename: 'Vårmötet-K7M2-QX4A.pdf', draftProgram: null },
  locale: 'sv-SE',
};

describe('the confirmation, on its history entry', () => {
  it('comes back as it was shown, in the language it was shown in', () => {
    expect(readFinished(finishedState(finished))).toEqual(finished);
  });

  it('is absent from an entry that never had it — a fresh visit to the link', () => {
    expect(readFinished(null)).toBeNull();
    expect(readFinished(undefined)).toBeNull();
    expect(readFinished({ somethingElse: true })).toBeNull();
  });

  it('never carries the answers, whatever the caller had', () => {
    const state = finishedState({
      ...finished,
      ...({ values: { full_name: 'Åsa' } } as object),
    } as typeof finished);
    expect(JSON.stringify(state)).not.toContain('Åsa');
  });

  it('is ignored after a day, or when it claims to come from the future', () => {
    const then = new Date('2030-01-01T10:00:00Z');
    const state = finishedState(finished, then);
    expect(readFinished(state, new Date('2030-01-02T09:59:00Z'))).not.toBeNull();
    expect(readFinished(state, new Date('2030-01-02T10:01:00Z'))).toBeNull();
    expect(readFinished(state, new Date('2029-12-31T10:00:00Z'))).toBeNull();
  });

  it('shrugs off a malformed entry', () => {
    expect(readFinished({ loppaFinished: 'nonsense' })).toBeNull();
    expect(readFinished({ loppaFinished: { reference: 7, at: Date.now() } })).toBeNull();
    const partial = readFinished({
      loppaFinished: { reference: 'R', at: Date.now(), document: { token: 1 } },
    });
    expect(partial?.document).toBeNull();
  });
});
