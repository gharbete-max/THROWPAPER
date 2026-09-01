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
docker build -t formwork .
```

**Demo** — in memory, no database, mail never sent:

```bash
docker run -p 4001:4001 -e DEMO=true formwork
```

**Real** — needs Postgres and a signing secret:

```bash
docker run -p 4001:4001 \
  -e DATABASE_URL=postgres://user:pass@host:5432/throwpaper \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  -e APP_URL=https://forms.example.com \
  -e MAIL_PROVIDER=ses \
  -e MAIL_REGION=eu-north-1 \
  -e MAIL_FROM=anmalan@example.com \
  -v formwork-documents:/app/.documents \
  formwork
```

The API serves the built app as well, so this single container is the whole product. That is a
convenience, not a constraint — putting the static bundle on a CDN and pointing it at the API works
just as well, and is what you would do under real traffic.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes, unless `DEMO=true` | |
| `JWT_SECRET` | yes | ≥32 characters. **No default** — the server refuses to start without it, because a predictable secret mints admin sessions. |
| `APP_URL` | yes | Magic links point here and CORS is scoped to it. |
| `MAIL_PROVIDER` | `console` \| `ses` | `console` logs instead of sending. |
| `MAIL_REGION` | with `ses` | `eu-north-1`. |
| `MAIL_FROM` | with `ses` | Must be on a verified domain, or sending is refused with no override. |
| `MAIL_OPERATOR` | no | Where new-registration notifications go. |
| `DOCUMENT_DIR` | no | Defaults to `/app/.documents`. |
| `DEMO` | no | `true` starts the in-memory build. |
| `DEMO_ALLOW_PRODUCTION` | no | Required to run demo mode with `NODE_ENV=production`. |

## First run against a real database

```bash
pnpm db:migrate
pnpm db:seed      # optional; creates a demonstrable event and 200 registrations
```

Migrations are not run automatically at boot. That is deliberate: two containers starting at once
would race, and a migration that fails should stop a deploy rather than leave a half-started
server answering requests.

## Before the first real event

1. **Request SES production access.** A new account only delivers to verified addresses. Until AWS
   grants it, the phase 4 checkpoint — does mail reliably land in real inboxes — cannot be tested
   at all. It has a turnaround, so start it early.
2. **Verify the sending domain.** Publish SPF, DKIM and DMARC, then use the verification screen
   until all three pass. Sending from an unverified domain is refused, with no override.
3. **Send to a real Gmail and a real Outlook address** and confirm neither lands in spam. This is
   `START-HERE.md`'s own check and there is no substitute for it.
4. **Scan a QR with a phone.** No test replaces a camera.

## What is deliberately not here

No Kubernetes manifests, no Terraform, no autoscaling. One container and a Postgres is the correct
shape for a product with one organisation and its first customer, and guessing at an orchestration
layer before the hosting target is chosen would be inventing constraints rather than removing them.
