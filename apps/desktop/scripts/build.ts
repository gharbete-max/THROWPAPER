/**
 * Builds the desktop edition into `.stage/`, and with `--package win|mac|linux` turns that into
 * an installer under `release/` (ADR 0016).
 *
 * Why a staging folder rather than pointing electron-builder at the workspace: pnpm's symlinked
 * `node_modules` is exactly what electron-builder packs worst, and the app needs almost none of it.
 * The main process is one esbuild bundle — the Forms API and every `@tp/*` package inlined — and
 * only three packages stay real files on disk, each for a reason written beside it below. `npm`
 * installs those three into the stage, flat, and electron-builder packs that.
 *
 * Unpackaged, `pnpm --filter @tp/desktop start` runs Electron on the stage directly.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { macSigningPlan } from '../src/packaging/signing.js';

const root = resolve(import.meta.dirname, '..');
const repo = resolve(root, '..', '..');
const stage = join(root, '.stage');
const target = process.argv.includes('--package')
  ? process.argv[process.argv.indexOf('--package') + 1]
  : undefined;

/**
 * Left out of the bundle, installed into the stage as real packages:
 *
 * - `@electric-sql/pglite` loads its WebAssembly and data files from beside its own module.
 * - `playwright-core` drives a browser for PDFs when Settings names one (the window's own Chromium
 *   renders them otherwise, `src/main/pdf.ts`), and resolves its own files at runtime.
 *   (`playwright` is aliased to it: the full package would download browsers on install.)
 * - `@fontsource/inter` is read with `require.resolve` by `@tp/tokens/pdf` to embed the font in
 *   every PDF — missing, å ä ö would silently fall back to a system face.
 * - `pdf-lib` is loaded by file path in a worker thread, to open an uploaded PDF on a budget
 *   (`pdf-guard.ts` in both APIs). Bundled inline it has no path, and the app did not start.
 */
const RUNTIME_PACKAGES = [
  '@electric-sql/pglite',
  'playwright-core',
  '@fontsource/inter',
  'pdf-lib',
] as const;

function versionOf(name: string, from: string): string {
  const require = createRequire(join(from, 'package.json'));
  let dir = dirname(require.resolve(name));
  // Walk up from the entry to the package root.
  for (;;) {
    try {
      const manifest = require(join(dir, 'package.json')) as { name?: string; version: string };
      if (manifest.name === name) return manifest.version;
    } catch {
      // not the root yet
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find the version of ${name}`);
    dir = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function main(): Promise<void> {
  const apiForms = join(repo, 'apps', 'api-forms');
  const formsDist = join(repo, 'apps', 'forms', 'dist');
  if (!(await exists(join(formsDist, 'index.html')))) {
    throw new Error(
      'apps/forms/dist is missing. Run `pnpm --filter @tp/forms build` first — the desktop serves that bundle.',
    );
  }
  // Sign runs beside Forms on this computer (ADR 0016): its API is in the bundle, its signing
  // page and migrations ship as folders, like Forms' own.
  const apiSign = join(repo, 'apps', 'api-sign');
  const signDist = join(repo, 'apps', 'sign', 'dist');
  if (!(await exists(join(signDist, 'index.html')))) {
    throw new Error(
      'apps/sign/dist is missing. Run `pnpm --filter @tp/sign build` first — the desktop serves the signing page.',
    );
  }

  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  await build({
    entryPoints: [join(root, 'src', 'main', 'main.ts')],
    outfile: join(stage, 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron', ...RUNTIME_PACKAGES],
    alias: { playwright: 'playwright-core' },
    // CommonJS dependencies (Fastify among them) call `require`, which an ES module lacks.
    banner: {
      js: "import { createRequire as __tpCreateRequire } from 'node:module'; const require = __tpCreateRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });

  await build({
    entryPoints: [join(root, 'src', 'main', 'preload.ts')],
    outfile: join(stage, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    logLevel: 'warning',
  });

  execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  await cp(formsDist, join(stage, 'web'), { recursive: true });
  await cp(join(apiForms, 'drizzle'), join(stage, 'drizzle'), { recursive: true });
  await cp(signDist, join(stage, 'sign-web'), { recursive: true });
  await cp(join(apiSign, 'drizzle'), join(stage, 'sign-drizzle'), { recursive: true });
  await mkdir(join(stage, 'build'), { recursive: true });
  await cp(join(repo, 'apps', 'forms', 'public', 'icon-512.png'), join(stage, 'build', 'icon.png'));

  const own = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string;
    description: string;
  };
  const tokens = join(repo, 'packages', 'tokens');
  const dependencies = {
    '@electric-sql/pglite': versionOf('@electric-sql/pglite', apiForms),
    'playwright-core': versionOf('playwright-core', join(repo, 'node_modules', 'playwright')),
    '@fontsource/inter': versionOf('@fontsource/inter', tokens),
    'pdf-lib': versionOf('pdf-lib', apiForms),
  };
  await writeFile(
    join(stage, 'package.json'),
    JSON.stringify(
      {
        name: 'loppa',
        productName: 'Loppa',
        version: own.version,
        description: own.description,
        // electron-builder requires an author; the legal name is the owner's (LAUNCH-CHECKLIST §6).
        author: 'Loppa',
        license: 'UNLICENSED',
        private: true,
        type: 'module',
        main: 'main.js',
        /*
         * electron-builder picks the package manager from this field before anything else. Without
         * it, run under `pnpm exec`, it believes pnpm, finds the workspace and packs pnpm's entire
         * tree — eleven thousand files the app never loads — instead of these three.
         */
        packageManager: `npm@${execFileSync('npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim()}`,
        dependencies,
      },
      null,
      2,
    ),
  );

  // Flat, from npm, with a lockfile, so the folder is unambiguously an npm project.
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stage,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });

  console.log(`desktop: staged in ${stage}`);

  if (target) {
    const flags: Record<string, string> = { win: '--win', mac: '--mac', linux: '--linux' };
    const platformFlag = target ? flags[target] : undefined;
    if (!platformFlag) throw new Error(`--package takes win, mac or linux, not ${target}`);
    const args = [
      'exec',
      'electron-builder',
      platformFlag,
      // The stage is the project, so electron-builder sees an npm app with three dependencies and
      // never the pnpm workspace around it.
      '--projectDir',
      stage,
      '--config',
      join(root, 'electron-builder.yml'),
      // Electron is a dev dependency of this package, not of the stage, so name its version.
      `-c.electronVersion=${versionOf('electron', root)}`,
      // Hooks resolve against the project directory, which is the stage; name ours absolutely.
      `-c.afterPack=${join(root, 'scripts', 'after-pack.cjs')}`,
    ];
    /*
     * The NSIS installer and the portable .exe run Windows tools while they are built, and
     * stamping the icon into Loppa.exe (rcedit) does too — on Linux or macOS all three need wine.
     * Cross-built, the Windows output is therefore a zip holding Loppa.exe with Electron's own
     * icon: a real, runnable build for testing, not the release. The release workflow builds on
     * windows-latest, where the installer, the portable .exe and the stamp all happen.
     */
    if (target === 'win' && process.platform !== 'win32') {
      args.push('--x64', '-c.win.target=zip', '-c.win.signAndEditExecutable=false');
    }
    // Likewise a .dmg needs macOS's own disk-image tool, and signing needs its codesign. Off a
    // Mac, the macOS output is an unsigned zip — which an Apple Silicon Mac will refuse to run.
    // It proves the packaging; the release comes from macos-latest. Nor is there a codesign to
    // re-sign the binary after its fuses are flipped: asked to, @electron/fuses crashes.
    let macSigning = 'ad-hoc';
    if (target === 'mac' && process.platform !== 'darwin') {
      args.push(
        '-c.mac.target=zip',
        '-c.mac.identity=null',
        '-c.mac.hardenedRuntime=false',
        '-c.electronFuses.resetAdHocDarwinSignature=false',
      );
    } else if (target === 'mac') {
      // Ad-hoc, or the owner's Developer ID and notarisation when their secrets are set.
      const plan = macSigningPlan(process.env, join(root, 'packaging', 'entitlements.mac.plist'));
      for (const warning of plan.warnings) console.warn(`desktop: ${warning}`);
      console.log(
        `desktop: macOS signing ${plan.signing}${plan.notarise ? ', notarised' : ', not notarised'}`,
      );
      args.push(...plan.args);
      macSigning = plan.signing;
    }
    args.push('--publish', 'never');
    execFileSync('pnpm', args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      // scripts/after-pack.cjs ad-hoc signs only when nothing better will sign after it.
      env: { ...process.env, LOPPA_MAC_SIGNING: macSigning },
    });
  }
}

await main();
