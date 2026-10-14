import { AiError, type Engine } from '../engine.js';

/**
 * The seam for a supervised `llama-server` child process (docs/plan/AI-SYSTEM.md D1). NOT
 * IMPLEMENTED, and registered for no model: until Phase 3 does, every model with the `vision`
 * capability is "not available yet" and nothing pretends otherwise.
 *
 * What Phase 3 fills in, so the shape is not rediscovered:
 *
 * - `load`: start the pinned binary (manifest file with role `runtime`) on `127.0.0.1`, an
 *   ephemeral port and a per-session bearer token, with `--mmproj` when the model has a
 *   projector, no web UI; wait until it answers its health check.
 * - `run`: `read-page` sends one page picture and a JSON schema, validates the reply into a
 *   `StructuredDocument` page, and emits it; aborting the signal closes the request.
 * - `dispose`: kill the process. A process exit is how RAM and VRAM are given back, which is
 *   why vision does not use `node-llama-cpp`'s in-process unloading.
 *
 * Whatever it does, the coordinator's contract holds: one engine alive, loaded only after the
 * files were hashed, disposed before another model loads.
 */
export class ServerEngine implements Engine {
  load(): Promise<void> {
    return Promise.reject(new AiError('not-available', 'ServerEngine is not implemented yet'));
  }

  run(): Promise<never> {
    return Promise.reject(new AiError('not-available', 'ServerEngine is not implemented yet'));
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
