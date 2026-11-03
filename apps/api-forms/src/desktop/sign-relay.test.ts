import { describe, expect, it } from 'vitest';
import { isRelayed, SIGN_RULES } from './phone-relay.js';

const ENVELOPE = '0b1f6c1e-2a43-4f7b-9d11-5d6f0f6f3a21';
const TOKEN = `${ENVELOPE}.cDE.bWFjLW1hYy1tYWMtbWFjLW1hYy1tYWM`;
const pass = (method: string, url: string) => isRelayed(method, url, SIGN_RULES);

describe('what the LAN relay lets a signer scanning a QR code reach', () => {
  it('passes the signer page, its document, the two things it does, and the static app', () => {
    expect(pass('GET', `/s/${TOKEN}`)).toBe(true);
    expect(pass('GET', `/api/v1/sign/${TOKEN}`)).toBe(true);
    expect(pass('GET', `/api/v1/sign/${TOKEN}/document`)).toBe(true);
    expect(pass('POST', `/api/v1/sign/${TOKEN}`)).toBe(true);
    expect(pass('POST', `/api/v1/sign/${TOKEN}/decline`)).toBe(true);
    expect(pass('GET', '/assets/index-abc123.js')).toBe(true);
  });

  it('refuses everything else of Sign, and everything of Forms', () => {
    for (const [method, url] of [
      ['GET', '/'],
      ['GET', '/v1/envelopes'],
      ['POST', '/api/v1/envelopes'],
      ['GET', `/api/v1/envelopes/${ENVELOPE}`],
      ['GET', '/api/v1/declarations'],
      ['GET', `/api/v1/sign/${TOKEN}/sealed`],
      ['DELETE', `/api/v1/sign/${TOKEN}`],
      ['GET', `/s/${TOKEN}/../../api/v1/envelopes`],
      ['GET', '/s/short'],
      ['GET', '/api/v1/signing/requests'],
      ['GET', '/phone-scan/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456'],
    ] as const) {
      expect(pass(method, url), `${method} ${url}`).toBe(false);
    }
  });
});
