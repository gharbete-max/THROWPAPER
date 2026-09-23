# Deploying

`START-HERE.md` phase 0 said "deployed to the real hosting target — day one, not at the end". That
did not happen, and it has been the thing blocking the phase 4 checkpoint ever since: you cannot
verify that email lands in real inboxes without a real domain, and you cannot open a phone camera
on the check-in screen without HTTPS.

This document is what makes that decision actionable. It does not make it for you.

## What has to be true of the host

- **Chromium.** Admission PDFs render through Playwright. The image carries the browser, which
  makes it roughly 1.5GB and gives it a real memory floor — a 256MB container will fail the first
  time somebody generates a document, not at boot. Budget ~1GB.
- **A persistent volume** at `/app/.documents` if bulk exports should survive a restart. Without
  one they vanish. Acceptable for a demo; not for production. `SPEC-forms.md` §7 wants S3 here and
  the `DocumentStore` interface is where that goes.
- **HTTPS.** The check-in camera will not open without it. `localhost` is exempt, a phone on your
  network is not.
- **A region.** `SPEC-mailer.md` §0 has `{{DATA_REGION}}`, and SES is already chosen as
  `eu-north-1` (Stockholm). Putting the application somewhere else does not break anything, but it
  does make the residency story harder to state.

## One image, two modes

```bash
docker build -t loppa .
```

The build copies the OCR runtime — `tesseract.js`'s worker, its WebAssembly cores and twelve
language models, about 45 MB — out of `node_modules` into `apps/forms/public/ocr/`
(`scripts/ocr-assets.ts`, run by the app's `build` and `dev` scripts). It needs no network
beyond `pnpm install`: the models are ordinary npm packages (`@tesseract.js-data/<lang>`). They
are served from this origin because the content security policy allows no CDN, and they are
fetched by a browser only when somebody draws a box on a photographed page in the builder.

**Demo** — in memory, no database, mail never sent:

```bash
docker run -p 4001:4001 -e DEMO=true -e DEMO_ALLOW_PRODUCTION=true loppa
```

Both variables are needed, and that is deliberate. The image runs as `NODE_ENV=production`, and a
demo binary that boots as production with no database and no real mail is the failure worth
designing against — so it has to be asked for twice.

**Real** — needs Postgres and a signing secret:

```bash
docker run -p 4001:4001 \
  -e DATABASE_URL=postgres://user:pass@host:5432/throwpaper \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  -e DOCUMENT_SIGNING_SECRET="$(openssl rand -base64 32)" \
  -e APP_URL=https://forms.example.com \
  -e MAIL_PROVIDER=ses \
  -e MAIL_REGION=eu-north-1 \
  -e MAIL_FROM=anmalan@example.com \
  -v loppa-documents:/app/.documents \
  loppa
```

The API serves the built app as well, so this single container is the whole product. That is a
convenience, not a constraint — putting the static bundle on a CDN and pointing it at the API works
just as well, and is what you would do under real traffic.

The app calls `/api/v1/...`. In development Vite proxies that here and strips the prefix; with
`SERVE_APP` set the server strips it itself, so both halves speak the same URLs either way. If you
do split the bundle onto a CDN, that rewrite is the thing to reproduce in front of the API.

Nothing at runtime needs pnpm, corepack or a TypeScript loader: both entry points are compiled, and
the workspace packages are bundled into them. The container runs `node`.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes, unless `DEMO=true` | |
| `JWT_SECRET` | yes | ≥32 characters. **No default** — the server refuses to start without it, because a predictable secret mints admin sessions. |
| `DOCUMENT_SIGNING_SECRET` | yes | ≥32 characters, and not the same string as `JWT_SECRET` — the server refuses both. Signs download links; rotating it invalidates every outstanding link and nothing else. |
| `APP_URL` | yes | Magic links point here and CORS is scoped to it. |
| `TRUST_PROXY` | behind any proxy | Which forwarders to believe about the visitor's address, as a comma-separated list of addresses, CIDRs or `loopback` / `linklocal` / `uniquelocal`. Empty (the default) means the socket is the visitor — right with nothing in front, wrong behind a TLS terminator, where every rate limit then keys on the proxy. Never `true`: that believes what the client wrote. |
| `API_FORMS_HOST` | no | Interface to listen on. Defaults to `0.0.0.0`, which the container needs. |
| `MAIL_PROVIDER` | `console` \| `ses` \| `smtp` \| `outbox` | `console` logs instead of sending. `smtp` is the direct fallback (`CLAUDE.md` rule 2) through `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` for 465; otherwise STARTTLS is required), `SMTP_USER`, `SMTP_PASSWORD`. `outbox` writes each message as an `.eml` to `MAIL_OUTBOX_DIR` and sends nothing. The sending-domain check applies to `ses` and `smtp`. |
| `MAIL_REGION` | with `ses` | `eu-north-1`. |
| `MAIL_FROM` | with `ses`, `smtp`, `outbox` | Must be on a verified domain for `ses` and `smtp`, or sending is refused with no override. |
| `MAIL_OPERATOR` | no | Where new-registration notifications go. |
| `CONTACT_TO` | no | Where the marketing site's "get in touch" form goes — your inbox. Unset, the form answers 503. |
| `DOCUMENT_DIR` | no | Defaults to `/app/.documents`. Respondent uploads live under `uploads/` beside it (`UPLOAD_DIR` overrides); the API sweeps uploads nobody claimed within 30 days once an hour, inside the process. |
| `DEMO` | no | `true` starts the in-memory build. |
| `DEMO_ALLOW_PRODUCTION` | with `DEMO` | The image is `NODE_ENV=production`, so a demo needs this too. |

## First run against a real database

```bash
pnpm db:migrate
pnpm db:seed      # creates the first administrator, a demonstrable event and 200 registrations
```

Migrations are not run automatically at boot. That is deliberate: two containers starting at once
would race, and a migration that fails should stop a deploy rather than leave a half-started
server answering requests.

### `db:seed` is how the first administrator exists

**It is not optional on a fresh database.** Everything else about people is done in the product —
an administrator adds colleagues, changes roles and disables accounts on `/users` — but that
requires an administrator to already be there, and there is deliberately no first-run flow that
lets whoever arrives first become one. ADR 0002 records why: a bootstrap endpoint guarded only by
"the organisation has no users yet" is an unauthenticated write whose guard an attacker can
observe, and the race is narrow and completely fatal.

So the first administrator comes from the seed, run by whoever has the database at the moment they
have it. Change the seeded address to a real one before running it against anything but a demo —
it is `admin@example.com`, and a magic link sent there reaches nobody.

The consequence to know about: an organisation that disables or demotes its last administrator
would be locked out, so the product refuses to do either. If it somehow happens anyway, the way
back is this database, not a support screen.

## What survives a restart, and what does not

Proven by `e2e/restart.spec.ts`, which kills the API with SIGKILL between creating things and
asking for them back — so this is measured, not assumed.

- **Rows** — organisations, users, forms, submissions, events, check-ins, jobs, audit — are in
  Postgres and survive anything the process does.
- **Bytes** — generated documents (`DOCUMENT_DIR`), respondent uploads (`uploads/` beside it) and
  public assets such as logos (`assets/` beside it) — are files on the container's disk. They
  survive a restart **only if `/app/.documents` is a volume.** Lose the volume and every signed
  download link and every logo answers 404 while the rows that point at them remain. A second
  instance sees the same rows and a different disk; that is the day an object store is needed.
- **Queued work** is rows, so it survives. A job that was *running* at the moment the process
  died is taken back after fifteen minutes and run again; the lost run counts against its
  `max_attempts`, so a job cannot be lost and cannot loop forever either.
- **A stop is not a crash.** SIGTERM (`docker stop`) and SIGINT close the server: the worker's
  timer, the upload sweeper and Chromium are stopped before the process exits.

One customer's dataset is therefore **the database plus the document volume**, together. A backup
of one without the other is not a backup.

## Before the first real event

1. **Request SES production access.** A new account only delivers to verified addresses. Until AWS
   grants it, the phase 4 checkpoint — does mail reliably land in real inboxes — cannot be tested
   at all. It has a turnaround, so start it early.
2. **Verify the sending domain.** Publish SPF, DKIM and DMARC, then use the verification screen
   until all three pass. Sending from an unverified domain is refused, with no override.
3. **Send to a real Gmail and a real Outlook address** and confirm neither lands in spam. This is
   `START-HERE.md`'s own check and there is no substitute for it.
4. **Scan a QR with a phone.** No test replaces a camera.

## On one PC instead

Loppa desktop for Windows and macOS (`apps/desktop`, ADR 0016) is the same server with local
parts: an embedded Postgres (PGlite) in the user's application-data folder, mail to an outbox
folder, the user's SMTP server or the Outlook already on the computer, PDFs from the app's own
Chromium. Nothing on this page is needed for it; the `Desktop` workflow
builds the installer. The same thing without a window, on any OS:
`LOPPA_DATA_DIR=./local pnpm --filter @tp/api-forms desktop --demo`.

## What is deliberately not here

No Kubernetes manifests, no Terraform, no autoscaling. One container and a Postgres is the correct
shape for a product with one organisation and its first customer, and guessing at an orchestration
layer before the hosting target is chosen would be inventing constraints rather than removing them.
