import { join } from 'node:path';
import {
  startDesktopServer,
  type DesktopServer,
  type StartDesktopOptions,
} from '@tp/api-forms/desktop';
import { startLocalSign, type LocalSign } from '@tp/api-sign/local';

/**
 * How the shell puts two products on one computer (ADR 0016), without Electron in it — so the
 * wiring the app runs is the wiring the tests run.
 *
 * Sign lives in `<workspace>/sign`, inside the folder a backup copies, with its own database; Forms
 * lives beside it. Forms is handed Sign's address and a service token for its organisation, and
 * from then on the two talk CONTRACT §5 over loopback like any caller and any Sign.
 */
export interface Resources {
  /** `web`, `drizzle`, `sign-web`, `sign-drizzle`: the folders the stage ships. */
  root: string;
}

export function startSign(
  dataDir: string,
  resources: Resources,
  port?: number,
): Promise<LocalSign> {
  return startLocalSign({
    dataDir: join(dataDir, 'sign'),
    migrationsFolder: join(resources.root, 'sign-drizzle'),
    webDir: join(resources.root, 'sign-web'),
    ...(port !== undefined ? { port } : {}),
  });
}

export function startForms(
  sign: LocalSign | null,
  options: Omit<StartDesktopOptions, 'signing'>,
): Promise<DesktopServer> {
  return startDesktopServer({
    ...options,
    signing: async (organisationId, origin) =>
      sign
        ? { apiUrl: sign.url, serviceToken: await sign.tokenFor(organisationId, [origin]) }
        : null,
  });
}
