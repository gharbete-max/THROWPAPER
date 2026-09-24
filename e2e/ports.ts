/** Shared by `playwright.config.ts` and the specs, so neither imports the other. */

/** Sign: api-sign serving the built signing page from one origin, as the desktop does. */
export const SIGN_PORT = 4003;

/** Sign's own database on the same server: `throwpaper_sign`, as `pnpm db:migrate` makes it. */
export function signDatabaseUrl(formsUrl: string): string {
  const url = new URL(formsUrl);
  url.pathname = '/throwpaper_sign';
  return url.toString();
}
