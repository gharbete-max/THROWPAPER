import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

/** Builds a real multipart body, so the parser is exercised rather than bypassed. */
async function upload(
  content: Buffer,
  options: { token?: string; filename?: string; type?: string } = {},
) {
  const form = new FormData();
  form.set(
    'file',
    new File([content], options.filename ?? 'logo.png', {
      type: options.type ?? 'image/png',
    }),
  );

  /**
   * One Response, read twice. Each `new Response(formData)` picks its own random boundary, so
   * taking the header from one and the body from another produces a body the parser cannot read —
   * which is exactly the "Unexpected end of multipart data" this originally failed with.
   */
  const encoded = new Response(form as never);
  const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
  if (!boundary) throw new Error('no boundary');
  const body = Buffer.from(await encoded.arrayBuffer());

  return harness.app.inject({
    method: 'POST',
    url: '/v1/uploads',
    headers: {
      ...(options.token === null ? {} : bearer(options.token ?? adminToken)),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

describe('uploading an image', () => {
  it('stores a PNG and returns the path to reference it by', async () => {
    const response = await upload(PNG);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.contentType).toBe('image/png');
    expect(body.bytes).toBe(PNG.byteLength);
    // Content-addressed: the key is the hash of the bytes, so the URL can be cached forever.
    expect(body.key).toBe(`${createHash('sha256').update(PNG).digest('hex')}.png`);
    expect(body.path).toBe(`/public/assets/${body.key}`);
  });

  it('stores the same image once however many times it is uploaded', async () => {
    const first = await upload(PNG);
    const second = await upload(PNG);

    expect(second.json().key).toBe(first.json().key);
    expect(harness.assets.files.size).toBe(1);
  });

  /**
   * The heart of it. The filename and the declared type are both written by whoever is uploading;
   * only the bytes are evidence. Serving this back as an image from the app's own origin would be
   * a stored cross-site scripting hole.
   */
  it('refuses HTML dressed up as a PNG', async () => {
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>', 'utf8');
    const response = await upload(html, { filename: 'logo.png', type: 'image/png' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('unsupported-format');
    expect(harness.assets.files.size).toBe(0);
  });

  it('refuses an SVG and explains what to send instead', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
    const response = await upload(svg, { filename: 'logo.svg', type: 'image/svg+xml' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('svg-not-supported');
  });

  it('lets an admin upload but not an operator', async () => {
    expect((await upload(PNG, { token: operatorToken })).statusCode).toBe(403);
  });

  it('refuses an anonymous upload', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/v1/uploads' });
    expect(response.statusCode).toBe(401);
  });
});

describe('serving an uploaded image', () => {
  it('serves it to anybody, because a logo is on a public form', async () => {
    const { key } = (await upload(PNG)).json();

    const response = await harness.app.inject({ method: 'GET', url: `/public/assets/${key}` });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(PNG)).toBe(true);
  });

  it('sends the headers that stop a browser second-guessing the type', async () => {
    const { key } = (await upload(PNG)).json();
    const response = await harness.app.inject({ method: 'GET', url: `/public/assets/${key}` });

    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // Immutable is only safe because the key is the hash of the content.
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it.each([
    ['a traversal', '/public/assets/..%2f..%2fetc%2fpasswd'],
    ['a bare filename', '/public/assets/logo.png'],
    ['a key with the wrong extension', `/public/assets/${'a'.repeat(64)}.svg`],
    ['a short key', '/public/assets/abc.png'],
  ])('404s %s without touching the store', async (_label, url) => {
    expect((await harness.app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('404s a well-formed key that was never uploaded', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/public/assets/${'0'.repeat(64)}.png`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('using an upload as a logo', () => {
  it('accepts the path the upload returned', async () => {
    const { path } = (await upload(PNG)).json();

    const response = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: { ...validKit(), logoLight: path },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tokens.logoLight).toBe(path);
  });

  /**
   * A brand kit is written by a customer and ends up in `src` attributes on a public page. An
   * arbitrary URL would leak every visitor's IP address to a third-party host and let whoever
   * controls it change what the form appears to say.
   */
  it.each([
    ['an external URL', 'https://evil.example.com/logo.png'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a protocol-relative URL', '//evil.example.com/logo.png'],
    ['a path outside the asset store', '/public/forms/varmotet'],
  ])('refuses %s as a logo', async (_label, value) => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/v1/brand-kit',
      headers: bearer(adminToken),
      payload: { ...validKit(), logoLight: value },
    });
    expect(response.statusCode).toBe(400);
  });
});

function validKit() {
  return {
    colour: {
      primary: '#1b263b',
      secondary: '#8b5a2b',
      accent: '#c68b59',
      background: '#f4f1ea',
      surface: '#fbfaf6',
      text: '#1b263b',
      muted: '#5a6478',
      border: '#ddd6c8',
      success: '#1f7a45',
      warning: '#7a5e10',
      danger: '#b3261e',
    },
    typography: {
      headingFont: 'Inter, system-ui, sans-serif',
      bodyFont: 'Inter, system-ui, sans-serif',
      baseSize: '16px',
      scaleRatio: 1.25,
      lineHeight: 1.5,
      weightRegular: 400,
      weightBold: 600,
    },
    spacingUnit: '8px',
    radius: '4px',
    borderWidth: '1px',
    shadowLevel: 0,
    buttonStyle: 'solid',
  };
}
