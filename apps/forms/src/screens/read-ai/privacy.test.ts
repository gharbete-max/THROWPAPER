import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CATALOGUES as messages } from '../../lib/messages/all.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');

/**
 * The AI reader and the proofreader hold a document's pictures and words (docs/plan/CAVEATS.md
 * #43): they go to this computer's shell over `window.loppaAi` and nowhere else, are kept in no
 * storage, and nothing here sends a message.
 */
describe('the AI reader and the proofreader keep what they hold on this computer', () => {
  const HOLD = [
    'screens/read-ai/ReadWithAi.tsx',
    'screens/read-ai/read-document.ts',
    'screens/read-ai/pictures.ts',
    'screens/proofread/ProofreadPanel.tsx',
    'screens/proofread/ProofreadSection.tsx',
    'lib/email-about-handoff.ts',
  ];

  it.each(HOLD)('%s never talks to the server and never stores anything', (name) => {
    expect(read(name)).not.toMatch(
      /lib\/api|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie/,
    );
  });

  it.each(HOLD)('%s sends nothing', (name) => {
    expect(read(name)).not.toMatch(/sendDocument|sendBatch|sendCampaign|client\./);
  });

  it('are loaded on demand, so they stay out of the entry chunk', () => {
    expect(read('screens/Scan.tsx')).toMatch(
      /lazy\(\(\) => import\('\.\/read-ai\/ReadWithAi\.js'\)\)/,
    );
    expect(read('screens/proofread/ProofreadSection.tsx')).toMatch(
      /lazy\(\(\) => import\('\.\/ProofreadPanel\.js'\)\)/,
    );
  });

  it('offer nothing where the desktop shell has no bridge', () => {
    expect(read('screens/proofread/ProofreadSection.tsx')).toMatch(/if \(!bridge/);
    expect(read('screens/Scan.tsx')).toMatch(/aiBridge\(\) \?/);
  });
});

describe('the words of the AI reader and the proofreader', () => {
  const KEYS = Object.keys(messages['en-GB']!).filter((key) => /^(read|proof|about)\./.test(key));

  it('exist in every language, with the same fill-ins', () => {
    const fills = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();
    expect(KEYS.length).toBeGreaterThan(50);
    for (const [code, catalogue] of Object.entries(messages)) {
      for (const key of KEYS) {
        const text = (catalogue as Record<string, string>)[key];
        expect(text, `${code} ${key}`).toBeTruthy();
        expect(fills(text!), `${code} ${key}`).toBe(
          fills((messages['en-GB'] as Record<string, string>)[key]!),
        );
      }
    }
  });

  it('name every reason a page can be marked and every kind of issue', () => {
    for (const key of [
      'read.reason.mismatch',
      'read.reason.cut-off',
      'read.reason.repetition',
      'read.reason.unreadable-output',
      'read.reason.not-read',
      'proof.kind.spelling',
      'proof.kind.grammar',
      'proof.kind.wording',
      'proof.kind.factual-doubt',
    ]) {
      expect(KEYS).toContain(key);
    }
  });
});
