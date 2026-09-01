import { beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
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

describe('the template catalogue over HTTP', () => {
  it('lists every shipped template', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/form-templates',
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const ids = response.json().templates.map((template: { id: string }) => template.id);
    expect(ids).toEqual(formSchemas.FORM_TEMPLATES.map((template) => template.id));
  });

  it('is readable by an operator and refused to nobody in particular', async () => {
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/form-templates',
          headers: bearer(operatorToken),
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (await harness.app.inject({ method: 'GET', url: '/v1/form-templates' })).statusCode,
    ).toBe(401);
  });
});

describe('creating a form from a template', () => {
  it('copies the template into the draft', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: {
        slug: 'kontakt',
        title: { 'sv-SE': 'Kontakt', 'en-GB': 'Contact' },
        templateId: 'contact-enquiry',
      },
    });

    expect(response.statusCode).toBe(201);
    const keys = response.json().draftDefinition.fields.map((field: { key: string }) => field.key);
    expect(keys).toContain('message');
    expect(keys).toContain('topic');
  });

  /**
   * The copy has to be deep. If the draft shared structure with the shipped catalogue, the first
   * author to edit their form would rewrite the template for everybody who picked it afterwards —
   * in the same process, silently.
   */
  it('does not let editing a form reach the shipped template', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: {
        slug: 'kontakt',
        title: { 'sv-SE': 'Kontakt' },
        templateId: 'contact-enquiry',
      },
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
              id: 'only',
              key: 'only_field',
              type: 'short_text',
              label: { 'sv-SE': 'Enda fältet' },
              required: true,
            },
          ],
          settings: {},
        },
      },
    });

    const template = formSchemas.findTemplate('contact-enquiry');
    expect(template!.definition.fields.length).toBeGreaterThan(1);
    expect(template!.definition.fields.map((field) => field.key)).toContain('message');
  });

  it('starts empty when no template is named', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: { slug: 'tomt', title: { 'sv-SE': 'Tomt' } },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().draftDefinition.fields).toEqual([]);
  });

  /**
   * Refused rather than ignored. Handing back an empty form to somebody who asked for "Customer
   * feedback" is discovered ten minutes into rebuilding it by hand.
   */
  it('refuses a template id nobody shipped', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: { slug: 'nonsens', title: { 'sv-SE': 'Nonsens' }, templateId: 'does-not-exist' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown-template');
    // And nothing was created on the way to refusing.
    expect(harness.state.forms).toHaveLength(0);
  });

  it('produces a form that can be published and filled in', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: {
        slug: 'enkat',
        title: { 'sv-SE': 'Enkät', 'en-GB': 'Survey' },
        templateId: 'customer-feedback',
      },
    });
    const formId = created.json().id;

    // Straight to publish: a template that needs editing before it can be published is not a
    // template, it is homework.
    const published = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/publish`,
      headers: bearer(adminToken),
      payload: { overrideIncompleteTranslations: false },
    });
    expect(published.statusCode).toBe(200);

    const submitted = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/enkat',
      payload: { locale: 'sv-SE', values: { rating: '5' } },
    });
    expect(submitted.statusCode).toBe(201);
  });

  it.each(formSchemas.FORM_TEMPLATES.map((template) => [template.id] as const))(
    'publishes %s without an author having to fix anything first',
    async (templateId) => {
      const created = await harness.app.inject({
        method: 'POST',
        url: '/v1/forms',
        headers: bearer(adminToken),
        payload: {
          slug: `t-${templateId}`.slice(0, 60),
          title: { 'sv-SE': templateId, 'en-GB': templateId },
          templateId,
        },
      });
      expect(created.statusCode).toBe(201);

      const published = await harness.app.inject({
        method: 'POST',
        url: `/v1/forms/${created.json().id}/publish`,
        headers: bearer(adminToken),
        payload: { overrideIncompleteTranslations: false },
      });
      expect(published.statusCode, published.body).toBe(200);
    },
  );
});
