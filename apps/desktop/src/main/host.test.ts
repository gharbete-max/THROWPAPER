import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PdfRenderer } from '@tp/api-forms/desktop';
import { startForms, startSign } from './host.js';

/**
 * The desktop's two products, started the way the shell starts them (`host.ts`), each on PGlite,
 * talking over real loopback sockets: an organisation sends a PDF for signing, the signer signs at
 * the local Sign, and the sealed file comes back through Forms. No network beyond 127.0.0.1.
 */
const repo = resolve(import.meta.dirname, '..', '..', '..', '..');
const scratch = await mkdtemp(join(tmpdir(), 'loppa-host-'));
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const fakeRenderer: PdfRenderer = {
  render: async () => Buffer.from('%PDF-fake'),
  renderPages: async () => Buffer.from('%PDF-fake'),
  close: async () => {},
};

/** A one-page PDF, by hand. */
function tinyPdf(): Buffer {
  const stream = 'BT /F1 18 Tf 72 760 Td (Offline lease) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** The folders the stage ships, laid out as the shell reads them. */
async function resources(): Promise<string> {
  const root = join(scratch, 'resources');
  await mkdir(join(root, 'web'), { recursive: true });
  await writeFile(join(root, 'web', 'index.html'), '<!doctype html><div id="root"></div>');
  await mkdir(join(root, 'sign-web'), { recursive: true });
  await writeFile(join(root, 'sign-web', 'index.html'), '<!doctype html><title>sign</title>');
  await cp(join(repo, 'apps', 'api-forms', 'drizzle'), join(root, 'drizzle'), { recursive: true });
  await cp(join(repo, 'apps', 'api-sign', 'drizzle'), join(root, 'sign-drizzle'), {
    recursive: true,
  });
  return root;
}

describe('Forms and Sign on one computer', { timeout: 120_000 }, () => {
  it('sends a PDF, signs it at the local Sign, and hands back the sealed file — offline', async () => {
    const root = await resources();
    const dataDir = join(scratch, 'workspace');
    const sign = await startSign(dataDir, { root }, 0);
    const formsOptions = {
      dataDir,
      webDir: join(root, 'web'),
      migrationsFolder: join(root, 'drizzle'),
      // A real port, as the shell's fixed 47017 is: Forms tells Sign where to fetch the document
      // from, and a server started on port 0 only learns its port after it has said so.
      port: await freePort(),
      renderer: fakeRenderer,
    };
    let forms = await startForms(sign, formsOptions);
    try {
      // First run: no organisation yet, so nothing to give a token to.
      expect(forms.signingConnected).toBe(false);
      await forms.bootstrap({
        organisationName: 'Byalaget',
        name: 'Åke',
        email: 'ake@example.com',
      });
      // The shell restarts Forms after set-up, and now it is connected.
      await forms.close();
      forms = await startForms(sign, formsOptions);
      expect(forms.signingConnected).toBe(true);

      const link = await forms.signInLink();
      const exchanged = await fetch(`${forms.url}/v1/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: new URL(link!).searchParams.get('token') }),
      });
      const { accessToken } = (await exchanged.json()) as { accessToken: string };
      const auth = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

      const created = await fetch(`${forms.url}/v1/signing/requests`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          source: 'upload',
          documentName: 'Arrende',
          pdfBase64: tinyPdf().toString('base64'),
          parties: [{ name: 'Åke', locale: 'sv-SE' }],
          declarationKey: 'demo',
        }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const request = (await created.json()) as {
        id: string;
        parties: { signUrl: string }[];
      };
      const signUrl = request.parties[0]!.signUrl;
      expect(signUrl.startsWith(`${sign.url}/s/`)).toBe(true);

      // The signing page is served by the local Sign, and signing goes to it over loopback.
      expect((await fetch(signUrl)).status).toBe(200);
      const token = signUrl.split('/s/')[1]!;
      const signed = await fetch(`${sign.url}/v1/sign/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ typedName: 'Åke' }),
      });
      expect(signed.status).toBe(200);

      const sealed = await fetch(`${forms.url}/v1/signing/requests/${request.id}/sealed.pdf`, {
        headers: auth,
      });
      expect(sealed.status).toBe(200);
      expect(
        Buffer.from(await sealed.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
    } finally {
      await forms.close();
      await sign.close();
    }
  });
});
