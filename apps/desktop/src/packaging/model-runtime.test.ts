import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keptPlatformPackage, toPrune } from './model-runtime.js';

const INSTALLED = [
  '@node-llama-cpp/win-arm64',
  '@node-llama-cpp/win-x64',
  '@node-llama-cpp/win-x64-cuda',
  '@node-llama-cpp/win-x64-cuda-ext',
  '@node-llama-cpp/win-x64-vulkan',
  '@node-llama-cpp/mac-arm64-metal',
];

describe('what of the model runtime ships', () => {
  it('keeps the CPU package of the platform being packaged and nothing else', () => {
    expect(toPrune(INSTALLED, 'win32', 'x64')).toEqual([
      '@node-llama-cpp/win-arm64',
      '@node-llama-cpp/win-x64-cuda',
      '@node-llama-cpp/win-x64-cuda-ext',
      '@node-llama-cpp/win-x64-vulkan',
      '@node-llama-cpp/mac-arm64-metal',
      'node-llama-cpp/llama/gitRelease.bundle',
    ]);
    expect(keptPlatformPackage('darwin', 'arm64')).toBe('mac-arm64-metal');
    expect(keptPlatformPackage('darwin', 'x64')).toBe('mac-x64');
  });

  it('drops every platform package on a platform it does not know, rather than ship a guess', () => {
    expect(toPrune(INSTALLED, 'freebsd', 'x64').filter((n) => n.startsWith('@'))).toHaveLength(
      INSTALLED.length,
    );
  });

  it('is excluded again in the packaging config, in case the stage is not pruned', () => {
    const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
    for (const word of ['cuda', 'vulkan', 'gitRelease.bundle']) expect(yml).toContain(word);
    expect(yml).toContain('from: model');
  });
});
