/**
 * What of `node-llama-cpp`'s install ships in the installer (ADR 0023 section 2, ADR 0016).
 *
 * `npm install node-llama-cpp` brings a package per platform and GPU backend: Windows alone has a
 * CPU build (30 MB), CUDA (169), CUDA extras (351) and Vulkan (71), and the library carries a
 * 35 MB git bundle of llama.cpp's source for compiling. The model runs on the CPU with
 * `build: 'never'` (`llama-engine.ts`), so only the CPU package for the platform being packaged is
 * kept, and the source bundle goes. Measured in a scratch install on Windows: 683 MB before, 53
 * MB after, and the model still loads.
 */
export function keptPlatformPackage(platform: string, arch: string): string | null {
  const table: Record<string, string> = {
    'win32-x64': 'win-x64',
    'win32-arm64': 'win-arm64',
    'darwin-arm64': 'mac-arm64-metal',
    'darwin-x64': 'mac-x64',
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
  };
  return table[`${platform}-${arch}`] ?? null;
}

/** Folders under `node_modules` to delete, given what the install put there. */
export function toPrune(installed: readonly string[], platform: string, arch: string): string[] {
  const keep = keptPlatformPackage(platform, arch);
  const drop = installed
    .filter((name) => name.startsWith('@node-llama-cpp/'))
    .filter((name) => name !== `@node-llama-cpp/${keep}`);
  return [...drop, 'node-llama-cpp/llama/gitRelease.bundle'];
}
