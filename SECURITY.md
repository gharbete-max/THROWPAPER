# Security

## Reporting a vulnerability

See [`/.well-known/security.txt`](apps/forms/public/.well-known/security.txt).

> **PENDING:** the contact address is a business fact and is not yet filled in. Until it is, this
> file and `security.txt` both name a channel that does not exist. See `PRE-LAUNCH-AUDIT.md` §8.

---

## Incident response

Written before an incident, because the 72-hour clock in GDPR Art. 33 starts when you _become
aware_ of a breach, not when you finish investigating it. Half of that window is usually spent
deciding who is allowed to decide.

### The clock

| Deadline                    | Obligation                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Without undue delay**     | Contain: revoke sessions, rotate the signing secret, take the service down if that is what containment needs.                                                    |
| **72 hours from awareness** | Notify **IMY** (Integritetsskyddsmyndigheten) unless the breach is unlikely to result in a risk to individuals. Late notification must itself explain the delay. |
| **Without undue delay**     | Notify affected individuals, where the risk to them is **high**.                                                                                                 |
| Always                      | Record it in the internal breach register — including breaches you decide not to report, and why.                                                                |

### Order of contact

1. **PENDING — incident owner.** One named person who decides whether this is a breach. Not a
   committee; the 72 hours do not pause for a meeting.
2. **PENDING — deputy**, for when the first person is unreachable.
3. Legal counsel, before notifying IMY.
4. IMY, via their reporting form.
5. Affected individuals, if the risk is high.

### What to do first, in order

1. **Contain.** Revoke refresh tokens, rotate `JWT_SECRET` (this signs access tokens — rotating it
   invalidates every session), and if data is actively leaking, stop the service.
2. **Preserve evidence.** Snapshot the database and keep the application logs _before_ redeploying.
   A redeploy that fixes the hole and destroys the logs leaves you unable to say what was taken,
   which is the one thing the notification has to state.
3. **Establish scope** from the audit log (`auditLog`) and application logs: which records, whose
   personal data, over what period.
4. **Decide and record.** Reportable or not, and why.

### What counts as a breach here

Not only an intrusion. Confidentiality, integrity _and_ availability all count:

- Any exposure of `submissions.data` — respondent answers, which can contain anything a form
  author chose to ask for.
- Any exposure of respondent uploads (`formUploads`) or invoice recipient data.
- A magic-link or refresh token leaking in a way that permits impersonation.
- Irreversible loss of submissions — a failed restore is a breach, not just an outage.

### Rotation runbook

| Secret                    | Where it lives          | Effect of rotating                                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `JWT_SECRET`              | Host secret store       | Every access token invalid immediately; everyone signs in again.                      |
| `DOCUMENT_SIGNING_SECRET` | Host secret store       | Every outstanding download link invalid; a bulk export is re-run. Sessions untouched. |
| Database credentials      | Host secret store       | Requires redeploy.                                                                    |
| SES credentials           | Host secret store / IAM | Mail stops until replaced.                                                            |

### Known historical exposure

One secret has been committed to this repository's public history and must be treated as
compromised, per the standing rule that any key ever committed is:

- **`demo-mode-secret-not-for-production-use-only-here`** — a fallback `JWT_SECRET` used by demo
  mode when the variable was unset. Added in `1e8d57a`, removed in `7048bc5` ("Security headers,
  and a secret that was written down in public"), which replaced it with `randomBytes(32)`.

  **Impact:** anyone could have minted an admin session against a demo deployment that ran without
  an explicit `JWT_SECRET`. **Current code is not affected.** Nothing is deployed yet, so there is
  nothing to rotate — but any image built before `7048bc5` must never be run, and if one ever was,
  treat every session it issued as forged.

  It is left in history deliberately: rewriting published history breaks every clone, and the fix
  for a leaked credential is rotation, not deletion.

---

## Logging and retention

> **PENDING:** log retention is undefined. GDPR requires it to be finite and stated, and the
> incident procedure above depends on logs still existing when you need them. These two pull in
> opposite directions and the answer is a business decision — see `PRE-LAUNCH-AUDIT.md` §8 item 4.

What is logged today, and what is deliberately not:

- Fastify logs requests at `info`. **Bodies and headers are never logged** — the default serializer
  emits only method, URL and remote address — so form answers, respondent emails in a POST body,
  and the `Authorization` header do not reach the log.
- **The URL is logged, and in this app some URLs _are_ the credential.** `/i/<token>`,
  `/public/forms/:slug/resume/<token>` and the signed document download all carry their secret in
  the path, so every one was being written in cleartext on every request. `log-redaction.ts` now
  redacts by shape before the line is written, keeping a four-character prefix so two lines about
  one request can still be tied together during an incident.
- Tokens are stored **hashed** (`tokenHash`), so the log was the only place they appeared in the
  clear.
- `auditLog` records the actor, the action, and the requesting IP for operator actions.
- `loginTokens.requestedIp` and `refreshTokens.userAgent` are stored to make session abuse visible.
- ⚠️ **The `console` mail provider writes whole messages — including magic links — to the log**,
  and it is the default when `MAIL_PROVIDER` is unset. That is right for development and wrong
  anywhere else. Production must set `MAIL_PROVIDER=ses`.
