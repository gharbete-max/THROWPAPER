import { describe, expect, it } from 'vitest';
import {
  createConsoleSigningProvider,
  createUnconfiguredSigningProvider,
  type SigningRequest,
} from './provider.js';

function request(): SigningRequest {
  return {
    documentName: 'minutes.pdf',
    document: Buffer.from('%PDF-1.7 pretend'),
    contentType: 'application/pdf',
    parties: [{ id: 'chair', name: 'A Chair', locale: 'sv-SE' }],
  };
}

describe('the console signing provider', () => {
  it('never claims a real scheme signed anything', async () => {
    /**
     * The point of the test. A demo or a development database must not hold a row that reads as
     * BankID or Scrive — that is the one mistake in this area that cannot be found later, because
     * by then the row looks exactly like a genuine one.
     */
    const provider = createConsoleSigningProvider(() => {});
    const session = await provider.start(request());
    const result = await provider.status(session.reference);

    expect(result.status).toBe('signed');
    expect(result.evidence?.method).toBe('console');
    expect(result.evidence?.kind).toBe('drawn');
  });

  it('says out loud that it is not a signature', async () => {
    const lines: string[] = [];
    await createConsoleSigningProvider((message) => lines.push(message)).start(request());
    expect(lines.join('\n')).toContain('NOT A REAL SIGNATURE');
  });

  it('offers no sign-in URL rather than a made-up one', async () => {
    const session = await createConsoleSigningProvider(() => {}).start(request());
    expect(session.signUrls).toEqual({});
  });

  it('reports an unknown reference as failed rather than pending', async () => {
    // Pending would leave a caller polling forever for something that was never started.
    const result = await createConsoleSigningProvider(() => {}).status('nope');
    expect(result.status).toBe('failed');
  });
});

describe('no signing provider configured', () => {
  it('refuses loudly instead of quietly doing nothing', async () => {
    const provider = createUnconfiguredSigningProvider();
    await expect(provider.start(request())).rejects.toThrow(/No signing provider is configured/);
    await expect(provider.status('anything')).rejects.toThrow(/No signing provider is configured/);
  });
});
