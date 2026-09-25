import { expect, test } from '@playwright/test';
import { db, seededForm, signInAs, uniqueEmail } from './support.js';

/**
 * When a request fails, the screen says so — and never claims what did not happen.
 *
 * Three screens turned a failed list into an empty one ("no forms yet", "0 responses"), two waited
 * on it forever, and sign-in said "a link is on its way" whether or not the server took the request.
 * Each case here fails the one request in the browser, reads the screen, lets the request through
 * again and checks that "Try again" recovers.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

test('sign-in says a link was sent only when the server took the request', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'en-GB'));
  await page.goto('/login');
  await page.getByLabel('Email address').fill(uniqueEmail('login'));

  // Too many requests: the rate limit's own answer.
  await page.route('**/api/v1/auth/magic-link', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 429, code: 'rate-limited', message: 'Slow down' }),
    }),
  );
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByRole('alert')).toHaveText(/Too many sign-in links/);
  await expect(page.getByText(/on its way/)).toHaveCount(0);

  // No answer at all.
  await page.unroute('**/api/v1/auth/magic-link');
  await page.route('**/api/v1/auth/magic-link', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByRole('alert')).toHaveText(/could not be sent/);
  await expect(page.getByText(/on its way/)).toHaveCount(0);

  // The real server: accepted, and only now "on its way".
  await page.unroute('**/api/v1/auth/magic-link');
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByText(/on its way/)).toBeVisible();
});

test('a list that fails to load says so, and "Try again" loads it', async ({ page }) => {
  const { formId } = await seededForm(sql);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  const cases = [
    { url: '/forms', api: '**/api/v1/forms?**', loaded: page.locator('.card').first() },
    {
      url: `/forms/${formId}/submissions`,
      api: `**/api/v1/forms/${formId}/submissions**`,
      loaded: page.getByRole('heading', { name: /^Responses \(\d+\)$/ }),
    },
    {
      url: '/events',
      api: '**/api/v1/events',
      loaded: page.getByRole('heading', { name: 'Events', level: 1 }),
    },
    {
      url: '/signing',
      api: '**/api/v1/signing/requests',
      loaded: page.getByRole('heading', { name: 'Signing', level: 1 }),
    },
    {
      url: '/invoices',
      api: '**/api/v1/invoices',
      loaded: page.getByRole('heading', { name: 'Invoices', level: 1 }),
    },
  ];

  for (const { url, api, loaded } of cases) {
    await page.route(api, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'boom', message: 'Internal error' } }),
          })
        : route.continue(),
    );
    await page.goto(url);
    await expect(page.getByText('This could not be loaded.', { exact: false }), url).toBeVisible();
    // Never the empty state's claim about the data.
    await expect(page.getByText(/yet\b|No responses/i), url).toHaveCount(0);

    await page.unroute(api);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('This could not be loaded.', { exact: false }), url).toHaveCount(0);
    await expect(loaded, url).toBeVisible();
  }
});
