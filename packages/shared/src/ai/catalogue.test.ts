import { describe, expect, it } from 'vitest';
import {
  MODEL_REGISTRY,
  consentFor,
  consentMatches,
  isAllowedHost,
  minTotalMemoryBytes,
  recommendModel,
  totalBytes,
} from './index.js';

const GB = 1e9;
const ids = (list: readonly { id: string }[]) => list.map((m) => m.id);

describe('the hosts a model may come from', () => {
  it('are Hugging Face and its CDN, and nothing that merely ends alike', () => {
    expect(isAllowedHost('huggingface.co')).toBe(true);
    expect(isAllowedHost('cas-bridge.xethub.hf.co')).toBe(true);
    expect(isAllowedHost('cdn-lfs.huggingface.co')).toBe(true);
    expect(isAllowedHost('evilhf.co')).toBe(false);
    expect(isAllowedHost('huggingface.co.evil.test')).toBe(false);
    expect(isAllowedHost('github.com')).toBe(false);
  });
});

describe('the consent', () => {
  it('names the host, the files to fetch and their total, for every model', () => {
    for (const model of MODEL_REGISTRY) {
      const consent = consentFor(model)!;
      expect(consent.host).toBe('huggingface.co');
      expect(consent.totalBytes).toBe(totalBytes(model));
      expect(consent.files).toHaveLength(2); // the 7B's lighter projector is not fetched
    }
  });

  it('is exactly what would be fetched: another file, size or host is refused', () => {
    const model = MODEL_REGISTRY[2]!;
    const good = consentFor(model)!;
    expect(consentMatches(model, good)).toBe(true);
    expect(consentMatches(model, { ...good, totalBytes: good.totalBytes - 1 })).toBe(false);
    expect(consentMatches(model, { ...good, host: 'example.test' })).toBe(false);
    expect(consentMatches(model, { ...good, files: [good.files[0]] })).toBe(false);
    expect(consentMatches(model, true)).toBe(false);
    expect(consentMatches(model, null)).toBe(false);
  });
});

describe('the recommendation', () => {
  it('is the best tier that fits total and free memory', () => {
    const pick = (total: number, free: number) =>
      recommendModel(MODEL_REGISTRY, { totalBytes: total * GB, freeBytes: free * GB });
    expect(pick(32, 20)).toBe('qwen2.5-vl-7b-instruct-q4_k_m');
    expect(pick(16, 8)).toBe('qwen3-vl-4b-instruct-q4_k_m');
    expect(pick(8, 5)).toBe('qwen3-vl-2b-instruct-q4_k_m');
    expect(pick(32, 6.5)).toBe('qwen3-vl-2b-instruct-q4_k_m'); // plenty in all, little free now
  });

  it('falls back to the smallest model rather than to nothing', () => {
    expect(recommendModel(MODEL_REGISTRY, { totalBytes: 2 * GB, freeBytes: GB / 2 })).toBe(
      'qwen3-vl-2b-instruct-q4_k_m', // the smallest that works; both SmolVLM2 models are marked not working
    );
  });

  it('never recommends a model marked not working yet', () => {
    const broken = MODEL_REGISTRY.map((m, i) =>
      i === 0 ? { ...m, support: { state: 'not-working-yet' as const, evidence: 'x' } } : m,
    );
    expect(recommendModel(broken, { totalBytes: 64 * GB, freeBytes: 40 * GB })).not.toBe(
      ids(MODEL_REGISTRY)[0],
    );
  });

  it('wants 15 per cent more than the working set in all', () => {
    expect(minTotalMemoryBytes(MODEL_REGISTRY[0]!)).toBe(11.5 * GB);
  });
});
