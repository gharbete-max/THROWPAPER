# ADR 0026 — The launch position: offline first, the network only on a confirmed action

**Status:** accepted 2026-10-20 (the owner asked that the open product decisions be made from the
vision: Loppa must run completely offline; a local network may be used occasionally, sparingly,
and only with the person's confirmation).

## Decisions

1. **The desktop app is the product.** It runs with no network, no account and no key. The hosted
   web edition and the marketing site are optional extras; their open items (`LAUNCH-CHECKLIST.md`
   §1 to §3: company details, policy text, terms, pricing, hosting, SES, domain) **block a hosted
   launch only, not the desktop release.** The desktop release needs a plain licence notice and
   the third-party notices already in the repository.
2. **The network rule.** Nothing touches the network unless the person triggers it, and the screen
   that triggers it names the host, what is sent or fetched, and its size, and waits for a press.
   The complete list of permitted uses:
   - fetching the AI pack or the `llama-server` runtime (a GitHub release, hash-verified, never
     automatic; the pack can instead be placed by hand from files, which is the offline path). The
     runtime is fetched in the app only where the installer does not carry it (macOS, any other
     system; Windows x64 has it in the installer) and for the optional graphics-card build; the pack
     from its published release is the second way to get the model, beside the download from Hugging
     Face (see "Amendment 2026-10-26");
   - the update check and the installer download (Amendment 2026-10-26): a question to the list of
     releases on api.github.com, and then, if the person asks, the installer for this computer from
     github.com, each behind its own button and confirmation, never at start-up and never repeated;
   - sending mail through a provider the person configured (SMTP or Outlook/Apple Mail drafts), after
     the Send confirmation, with test mode on until switched off;
   - the phone-scan relay and Sign links on the local network, only while that screen is open
     (ADR 0016), shown with the address that is being offered;
   - nothing else: no telemetry, no update ping, no cloud AI, no fonts or scripts from elsewhere.
3. **If a hosted edition is ever run**, the technical defaults are: an EU region; uploads and scans
   held only for the request (already true of the PDF routes); logs 30 days; backups 30 days;
   deleted organisations purged after 30 days; the summary and reader are never offered on it (a
   model on Loppa's server is not the person's own computer). Hosted Send stays available through
   the configured mail provider, in test mode until the operator switches it off. These are
   engineering defaults for the operator to adopt or change with counsel; they are not legal text.
4. **Campaign footer.** The sender still writes the footer (rule 8), but the field opens with a
   neutral skeleton of placeholders (who sent it, their address, why the person is receiving it,
   the unsubscribe link) and sending stays blocked while any placeholder is unfilled. The skeleton
   states no legal claim.
5. **Earlier features** (events, check-in, the ledger, invoicing arithmetic) stay where they are,
   out of the room, as `CLAUDE.md` already says. The "one switch" phase of `DOCUMENTS.md` is not
   built: it would add a settings screen to hide code that nothing links to. It is dropped.
6. **Mailer** stays parked. Campaigns inside Send are the mail feature; segments, schedules,
   approvals and bounce handling are not needed for a local-first helper and are not planned.
7. **Backups.** The desktop's "Back up" must not copy `secrets.json` in plain files. Default:
   exclude it; offer an encrypted backup protected by a passphrase the person types.
8. **The AI pack.** The model and projector are about 6 GB and live in their own folder beside the
   app, separate from code. Delivery is a set of parts under 2 GiB with SHA-256 hashes; the app
   opens a pack from disk (offline) or fetches it with the confirmation of decision 2.

The company name and number, addresses, terms, price and the data protection officer are out of scope for development. They are not an open decision; they are needed to sell or host Loppa, not to run it.

## Amendment 2026-10-26: Add-ons and updates

The owner's rule: after installing Loppa, nobody has to leave the app to look for files on GitHub or
elsewhere. Everything optional is reachable from **one page inside the app, "Add-ons and updates"**
(the former "Set up AI" page, same address, reached from the room's corner and from Summary), each
with a button, a plain description, its size and a confirmation that names the host. The page holds:
the AI model (the recommended one, one button; unchanged), **the AI program** (`llama-server`;
"Included" on Windows x64, a "Get the AI program" button on macOS and other systems), **the
graphics-card program**, **the AI pack** (the published pack release, about 6.9 GB, for offline
installs or computers that cannot reach Hugging Face; the model download from Hugging Face stays the
default) and **the update check**.

What this adds to the list of permitted network uses, and nothing else:

1. **The AI program for a system whose installer lacks it**: the pinned release asset of
   `ggml-org/llama.cpp` for that system (`packages/shared/src/ai/runtimes/llama-server.json`), after a
   confirmation naming `github.com`, the file and its size. The archive's SHA-256 is checked against
   the manifest **before it is opened**; it is unpacked by Loppa's own reader
   (`apps/desktop/src/addons/extract.ts`: no `..`, absolute path, drive letter or device name; no hard
   link or special file; a symbolic link only to a file beside it, written as a copy; caps on count,
   size and unpacked-to-packed ratio), into the user-data runtime folder the resolver already
   searches. A pinned asset nobody here has run is `verified: false`: the page says "Not tested on
   this kind of computer yet", and a program that does not start is reported plainly by the existing
   start-up path, never a crash. **macOS (Apple Silicon and Intel) is in that state**: this project
   cannot run macOS; the archives are pinned by the hash GitHub's release page gave, unpacked by the
   real code (tests, and the real arm64 archive on 2026-10-26), and not run.
2. **The AI pack from its release** (`ai-pack-<model id>` on the project's repository): `PACK.json`
   and the parts, by the model download's own machinery (resumable parts, each part's size and
   SHA-256 as it arrives, the joined file against the app's manifest, the disk checked first for the
   whole pack and the largest file again for the join, an atomic rename). `PACK.json` is read as
   untrusted: it must agree with the manifest, its part names must be the file's `.partN`, and the
   addresses are built from the tag and those names. The confirmation names `github.com`, the files
   and the total size.
3. **The update check**, pressed by the person: one request to the release list of the project's
   repository on `api.github.com`; the confirmation says nothing is sent but the request and nothing
   is installed. The newest release **whose tag starts `desktop-v`** is compared with the app's
   version (the pack release has another prefix; drafts and pre-releases are never offered). Nothing
   is repeated by a timer and nothing is remembered.
4. **The installer download**, pressed by the person after the check: the installer for this computer
   (Windows Setup, or the portable program for a portable copy; the macOS disk image for this chip)
   from `github.com`, saved in the Downloads folder under a versioned name, **its SHA-256 checked
   against the release's own `SHA256SUMS.txt`** (fetched from the same release; GitHub's digest for
   the file must agree where it gives one), a size cap of 600 MB, a temporary file and an atomic
   rename, and a file that does not match is deleted. Only then is "Open the installer" offered, and
   it re-checks the file first. **The app never runs an installer by itself.** The confirmation names
   `github.com`, the file and its size.

Where these may connect is a **third, narrower list**, separate from the model download's (Hugging
Face) and the runtime's: `github.com`, `api.github.com`, `release-assets.githubusercontent.com` and
`objects.githubusercontent.com` (checked by a real request on 2026-10-26), https only, the first
address and every redirect (five at most, followed by hand), no credentials, cookies or referrer, and
size caps on every answer (the release list 2 MB, a checksum file 64 KB, `PACK.json` 64 KB). The
pack and the update use this list; the model download's list is not widened.

The consent record (`consents.jsonl`) gets one line per confirmed action: the time, what it was
(`addon:program`, `addon:pack`, `addon:update-check`, `addon:installer`) and the three fields of the
consent, never anything else. Still no telemetry, no automatic check, no update ping.

## Follow-up work this creates

The footer skeleton (4) and the encrypted backup (7) are small code changes; the AI pack
distribution (8) is the packaging work already planned, and is now also met by the model catalogue (ADR 0025, section 6): a person may download a model from Hugging Face on a confirmed press. They are tracked in `docs/HANDOVER.md`.
