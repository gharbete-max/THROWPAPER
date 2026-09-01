import { beforeEach, describe, expect, it } from 'vitest';
import { defaultTokens } from '@tp/tokens';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

/** A valid kit that differs from the defaults in a way the assertions can see. */
function kit(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultTokens,
    colour: { ...defaultTokens.colour, primary: '#1B263B', background: '#F4F1EA' },
    ...overrides,
  };
}

describe('the brand kit', () => {
  it('falls back to the shipped defaults before anybody has chosen', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ customised: false, updatedAt: null });
    expect(response.json().tokens.colour.primary).toBe(defaultTokens.colour.primary);
  });

  it('stores a kit and serves it back', async () => {
    const saved = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit(),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ customised: true });

    const read = await harness.app.inject({
      method: 'GET',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
    });
    expect(read.json().tokens.colour.primary).toBe('#1b263b');
  });

  it('normalises hex so two spellings of one colour are one colour', async () => {
    const saved = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit({ colour: { ...defaultTokens.colour, primary: '#FFF' } }),
    });
    expect(saved.json().tokens.colour.primary).toBe('#ffffff');
  });

  it.each([
    ['a colour name', 'rebeccapurple'],
    ['an rgb() value', 'rgb(1,2,3)'],
    ['a CSS variable', 'var(--x)'],
    ['a half-written hex', '#12'],
  ])('refuses %s, because this is interpolated into email and print CSS', async (_label, value) => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit({ colour: { ...defaultTokens.colour, primary: value } }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a font stack carrying a quote, which would end a style attribute early', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit({
        typography: {
          ...defaultTokens.typography,
          bodyFont: 'Inter", onload="alert(1)',
        },
      }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('warns about contrast without refusing the save', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit({ colour: { ...defaultTokens.colour, text: '#eeeeee', background: '#ffffff' } }),
    });

    // Saved, and told. Refusing somebody's brand over contrast would be the tool overruling them.
    expect(response.statusCode).toBe(200);
    expect(response.json().warnings.map((w: { token: string }) => w.token)).toContain(
      'colour.text',
    );
  });

  it('lets an operator read the brand but not change it', async () => {
    const read = await harness.app.inject({
      method: 'GET',
      url: '/v1/brand-kit',
      headers: bearer(operatorToken),
    });
    expect(read.statusCode).toBe(200);

    const write = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(operatorToken),
      payload: kit(),
    });
    expect(write.statusCode).toBe(403);
  });

  it('refuses an anonymous request outright', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/brand-kit' });
    expect(response.statusCode).toBe(401);
  });

  it('resets by removing the row, not by storing a copy of the defaults', async () => {
    await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit(),
    });
    expect(harness.state.brandKits).toHaveLength(1);

    const reset = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
    });

    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ customised: false });
    expect(harness.state.brandKits).toHaveLength(0);
  });

  it('records the change in the audit log', async () => {
    await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit(),
    });

    const entry = harness.state.audit.find((row) => row.action === 'brand-kit.update');
    expect(entry).toBeDefined();
    expect(entry?.entityType).toBe('brand_kit');
  });

  it('ignores a stored kit that no longer parses, rather than serving a broken page', async () => {
    // A row written by an older schema, missing half its tokens.
    harness.state.brandKits.push({
      organisationId: harness.state.organisations[0]!.id,
      tokens: { colour: { primary: '#1b263b' } },
      updatedAt: new Date(),
      updatedBy: null,
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
    });

    // Falls back rather than handing a compiler `undefined` to interpolate into CSS.
    expect(response.statusCode).toBe(200);
    expect(response.json().tokens.colour.secondary).toBe(defaultTokens.colour.secondary);
  });

  it('sends the brand with the public form, so an anonymous visitor sees it', async () => {
    await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: kit(),
    });

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: { slug: 'anmalan', title: { 'sv-SE': 'Anmälan' } },
    });
    const formId = created.json().id;

    await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${formId}/draft`,
      headers: bearer(adminToken),
      payload: {
        definition: {
          schemaVersion: 1,
          fields: [
            {
              id: 'f1',
              key: 'full_name',
              type: 'short_text',
              label: { 'sv-SE': 'Namn' },
              required: true,
            },
          ],
          settings: {},
        },
      },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/publish`,
      headers: bearer(adminToken),
      payload: { overrideIncompleteTranslations: true },
    });

    const publicForm = await harness.app.inject({ method: 'GET', url: '/public/forms/anmalan' });
    expect(publicForm.statusCode).toBe(200);
    expect(publicForm.json().brand.colour.primary).toBe('#1b263b');
  });
});
