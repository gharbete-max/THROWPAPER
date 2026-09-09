/**
 * Keeping credentials out of the log, where several of this app's URLs *are* the credential.
 *
 * `/i/<token>` is an invoice anybody holding the link may read. `/public/forms/:slug/resume/<token>`
 * resumes somebody's half-finished submission. The document download carries an HMAC signature.
 * None of those have a session behind them — the string in the URL is the whole authorisation — so
 * a log line containing one is a log line that grants access to whoever can read it. Logs get
 * shipped, aggregated, and kept longer than anything else in the system.
 *
 * Matched by **shape, not by route**. A route added later gets this without anybody remembering,
 * and the alternative — a list of paths to redact — is a list that goes stale the first time
 * somebody is in a hurry.
 */

/**
 * A run long enough to be a secret rather than an identifier.
 *
 * Two rules, and both matter:
 *
 * **Alphanumeric only — no `-` or `_`.** Those belong to base64url, so including them was the
 * obvious thing to write, and it made a UUID match as one 36-character run: every
 * `/v1/events/<uuid>` in the log became `/v1/events/1111[redacted]`. Excluding them means a
 * separator ends the run, and a UUID's longest unbroken alphanumeric stretch is 12 — comfortably
 * under the floor. A JWT still matches, because its base64url segments are long alphanumeric runs.
 *
 * **24 is the floor.** The shortest token this app issues is 32 hex characters (`/i/:token`
 * validates `[a-f0-9]{32,64}`). A slug like `varmotet-2026` is far shorter. So nothing legitimate
 * is caught, and everything secret is.
 */
const SECRET_RUN = /[A-Za-z0-9]{24,}/g;

/**
 * Query values that are secret whatever their shape, because the name says so.
 *
 * `?token=abc` is short enough to slip past the length rule, and a short token is not a safe one —
 * it is just a shorter secret.
 */
const SECRET_PARAMS = /\b(token|signature|sig|key|secret|password|code)=[^&\s]+/gi;

export function redactSecretsInUrl(url: string): string {
  return url
    .replace(SECRET_PARAMS, (match) => `${match.split('=')[0]}=[redacted]`)
    .replace(
      SECRET_RUN,
      // Keep the first four characters: enough to correlate two log lines about the same request
      // during an incident, far too few to replay.
      (run) => `${run.slice(0, 4)}[redacted]`,
    );
}
