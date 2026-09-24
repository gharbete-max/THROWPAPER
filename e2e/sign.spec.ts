import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { expect, test } from '@playwright/test';
import { SIGN_PORT, signDatabaseUrl } from './ports.js';
import { tinyPdf } from './pdf.js';
import {
  coversWholeFile,
  extractSeal,
  opensslVerify,
} from '../apps/api-sign/src/sealing/openssl-validator.js';

/**
 * Sign, end to end, in a browser (ROADMAP P1c): a caller sends a PDF for signing, one party types
 * their name and the other draws, the sealed PDF comes back, its hash matches, OpenSSL accepts its
 * seal — and a single flipped byte makes OpenSSL refuse it.
 */
const SIGN = `http://localhost:${SIGN_PORT}`;
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

let documents: Server;
let origin: string;
const pdf = tinyPdf('Hyresavtal e2e');

test.beforeAll(async () => {
  documents = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf' });
    response.end(pdf);
  });
  await new Promise<void>((done) => documents.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(documents.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((done) => documents.close(done));
});

test('a typed and a drawn signature, sealed, verified, and a tampered copy refused', async ({
  page,
  request,
}) => {
  // A service token for a fresh organisation, allowed to have Sign fetch from our document server.
  const organisationId = randomUUID();
  const token = `svc_e2e_${randomUUID()}`;
  const sql = postgres(signDatabaseUrl(DATABASE_URL), { max: 1, onnotice: () => {} });
  try {
    await sql`insert into service_tokens (organisation_id, name, token_sha256, allowed_origins)
      values (${organisationId}, 'e2e', ${createHash('sha256').update(token).digest('hex')},
              array[${origin}]::text[])`;
  } finally {
    await sql.end();
  }
  const auth = { authorization: `Bearer ${token}` };

  const created = await request.post(`${SIGN}/v1/envelopes`, {
    headers: auth,
    data: {
      organisationId,
      documentName: 'Hyresavtal e2e',
      documentUrl: `${origin}/lease.pdf`,
      documentSha256: createHash('sha256').update(pdf).digest('hex'),
      parties: [
        { id: 'landlord', name: 'Åsa Öberg', locale: 'sv-SE', order: 1 },
        { id: 'tenant', name: 'Jon Smith', locale: 'en-GB', order: 2 },
      ],
      routing: 'sequential',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      // The seed's test-mode placeholder (`apps/api-sign/src/db/seed.ts`).
      declarationKey: 'demo',
      idempotencyKey: `e2e-${randomUUID()}`,
    },
  });
  expect(created.status()).toBe(201);
  const { envelopeId, signUrls } = await created.json();

  // The landlord signs first, by typing, and reads the page in Swedish.
  await page.goto(signUrls.landlord);
  await expect(page.getByTestId('declaration')).toContainText('endast testläge');
  await page.getByLabel('Ditt namn').fill('Åsa Öberg');
  await page.getByRole('button', { name: 'Signera', exact: true }).click();
  await expect(page.getByTestId('outcome')).toHaveText('Du har signerat.');

  // The tenant draws, in English.
  await page.goto(signUrls.tenant);
  await page.getByRole('tab', { name: 'Draw' }).click();
  const pad = page.getByTestId('sign-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.7);
  await page.mouse.down();
  for (const [x, y] of [
    [0.25, 0.2],
    [0.4, 0.75],
    [0.55, 0.3],
    [0.8, 0.6],
  ] as const) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByTestId('outcome')).toHaveText('Everyone has signed.');

  // The caller collects the sealed file.
  const sealed = await request.get(`${SIGN}/v1/envelopes/${envelopeId}/sealed`, { headers: auth });
  expect(sealed.status()).toBe(200);
  const { url, sealedSha256 } = await sealed.json();
  const bytes = new Uint8Array(await (await request.get(url)).body());
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sealedSha256);

  const seal = extractSeal(bytes);
  expect(coversWholeFile(bytes, seal.byteRange)).toBe(true);
  expect(opensslVerify(seal.signedContent, seal.cms, 'embedded').ok).toBe(true);

  const tampered = new Uint8Array(bytes);
  const at = Math.floor(seal.byteRange[1] / 2);
  tampered[at] = tampered[at]! ^ 0x01;
  const broken = extractSeal(tampered);
  expect(opensslVerify(broken.signedContent, broken.cms, 'embedded').ok).toBe(false);
});
