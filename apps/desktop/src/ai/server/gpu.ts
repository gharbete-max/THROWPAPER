import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { childEnv } from './llama-server.js';

/**
 * Which graphics card the Vulkan build of `llama-server` should use (docs/plan/VISION-TUNING.md §5).
 * The program lists its devices itself, with free memory: `llama-server --list-devices`. Nothing is
 * installed or probed by Loppa, and nothing leaves the computer.
 *
 * The first device is used: the program lists a separate card before the chip inside the processor
 * (measured: `Vulkan0` the RTX 4070, `Vulkan1` the UHD 770, which reports more "free" memory because
 * it is the computer's own RAM). Fitting the model to the card's memory is the program's own `--fit`.
 */
export interface GpuDevice {
  /** As the program names it, for `--device`: `Vulkan0`. */
  id: string;
  name: string;
  totalMiB: number;
  freeMiB: number;
}

/** `  Vulkan0: NVIDIA GeForce RTX 4070 (12010 MiB, 11242 MiB free)` */
const LINE = /^\s*([A-Za-z]+\d+)\s*:\s*(.+?)\s*\((\d+) MiB, (\d+) MiB free\)\s*$/;

export function parseDevices(text: string): GpuDevice[] {
  const out: GpuDevice[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) {
      out.push({ id: m[1]!, name: m[2]!, totalMiB: Number(m[3]), freeMiB: Number(m[4]) });
    }
  }
  return out;
}

/** Under this much free memory a card is left alone this time (the program keeps 1 GB for itself). Not a failure. */
export const MIN_FREE_MIB = 2048;

export function listDevices(
  entry: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GpuDevice[]> {
  return new Promise((resolve) => {
    execFile(
      entry,
      ['--list-devices'],
      { cwd: dirname(entry), timeout: 20_000, windowsHide: true, env: childEnv(env) },
      (error, stdout, stderr) => resolve(error ? [] : parseDevices(`${stdout}\n${stderr}`)),
    );
  });
}
