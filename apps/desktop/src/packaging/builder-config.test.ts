import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LLAMA_SERVER, runtimeAssetFor } from '@tp/shared/ai';
import { describe, expect, it } from 'vitest';

/**
 * The packaged app starts `llama-server` from `resources/ai-pack/runtime` (src/ai/resolve.ts looks
 * there), so the packaging must put the program there as plain files, never inside the asar. Read as
 * text: the repository has no YAML parser, by ADR 0021.
 */
const desktop = join(import.meta.dirname, '..', '..');
const config = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8');
const build = readFileSync(join(desktop, 'scripts', 'build.ts'), 'utf8');

describe('the desktop packaging and the AI pack', () => {
  it('ships ai-pack/ as an extra resource beside the asar, not inside it', () => {
    expect(config).toMatch(/extraResources:[\s\S]*?- from: ai-pack\r?\n\s+to: ai-pack/);
    // Not among the files of the asar, nor unpacked from it.
    const section = (name: string) =>
      config.split(new RegExp(`^${name}:`, 'm'))[1]!.split(/^\S/m)[0]!;
    expect(section('files')).not.toContain('ai-pack');
    expect(section('asarUnpack')).not.toContain('ai-pack');
  });

  it('stages the runtime where the resolver looks, with its hash list, only where it is verified', () => {
    expect(build).toContain("join(pack, 'runtime')");
    expect(build).toContain('RUNTIME.json');
    expect(build).toContain('asset?.verified');
    expect(runtimeAssetFor('win32', 'x64', LLAMA_SERVER)?.verified).toBe(true);
    // The CPU build: the pinned Windows asset is the cpu one, never a CUDA/Vulkan archive.
    expect(runtimeAssetFor('win32', 'x64', LLAMA_SERVER)?.name).toMatch(/-bin-win-cpu-x64\.zip$/);
  });

  it('never packs the model: the weights are far larger than an installer can carry', () => {
    expect(config).not.toMatch(/gguf/i);
    expect(build).not.toMatch(/\.gguf/);
  });

  it('keeps the fuse that loads code only from the asar, and the child program outside it', () => {
    expect(config).toMatch(/onlyLoadAppFromAsar: true/);
    expect(config).toMatch(/runAsNode: false/);
  });
});
