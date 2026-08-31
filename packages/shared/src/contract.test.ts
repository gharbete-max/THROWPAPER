import { describe, expect, it } from 'vitest';
import { CONTRACT_ENDPOINTS, SendMessageRequest, UpsertContact } from './contract/index.js';

describe('contract manifest', () => {
  it('has unique endpoint ids', () => {
    const ids = CONTRACT_ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SendMessageRequest', () => {
  const valid = {
    organisationId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    templateKey: 'registration.confirmation',
    locale: 'sv-SE',
    to: { email: 'a@example.com' },
    mergeData: { firstName: 'Alva' },
    idempotencyKey: 'reg-1234-confirm',
    category: 'transactional' as const,
  };

  it('accepts a well-formed transactional send', () => {
    expect(SendMessageRequest.parse(valid)).toMatchObject({
      templateKey: 'registration.confirmation',
    });
  });

  it('rejects a send with no idempotency key — retries must not double-send', () => {
    const { idempotencyKey: _omitted, ...withoutKey } = valid;
    expect(SendMessageRequest.safeParse(withoutKey).success).toBe(false);
  });

  it('rejects a marketing category on the transactional endpoint', () => {
    expect(SendMessageRequest.safeParse({ ...valid, category: 'marketing' }).success).toBe(false);
  });
});

describe('UpsertContact', () => {
  it('has no consent field — consent is Sendwork’s record, not Formwork’s', () => {
    const parsed = UpsertContact.parse({ contactRef: 'c1', email: 'a@example.com', consent: true });
    expect(parsed).not.toHaveProperty('consent');
  });
});
