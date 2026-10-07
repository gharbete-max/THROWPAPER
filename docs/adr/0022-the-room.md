# ADR 0022 — The room: three independent catchers, Documents first

**Status:** proposed 2026-10-07, for the owner's acceptance (phase 0 of `docs/plan/DOCUMENTS.md`)
**Vision:** `docs/VISION.md` · **Plan:** `docs/plan/DOCUMENTS.md`

## Context

The owner re-set what Loppa is (`docs/VISION.md`). You arrive in an empty dark grey room, where
three cootie catchers float: Documents (a red hue beneath it), Spreadsheets (green) and
Presentation & planning (yellow). The three never link to or affect each other. Documents opens
into Forms, Scan, Sign and Send around a summary, and is finished first. The other two are animated
placeholders.

Today a signed-in person lands on `/events` (`App.tsx`). On the hosted edition `/` is the
server-rendered marketing site (`site/routes.ts`). On the desktop a hard load of `/` would
client-render that site.

## Decision

1. **The room is `/room`** in `apps/forms`, on both editions, full screen with no rail.
   - Sign-in, the app's `/` and every unknown path land there instead of on `/events`.
   - The public site keeps `/`.
2. **The three catchers are independent tools.** No catcher imports, calls or links to another.
   This is stricter than rule 1: the catchers share no contract at all. Inside Documents, Forms and
   Sign still talk only over `docs/CONTRACT.md` §5.
3. **The placeholders are honest.** Spreadsheets and Presentation & planning float, are named and
   say "Not built yet". They have no link, handler or import, are not focusable, and a test holds
   all of that.
4. **The look is the room's own.**
   - The room is dark grey.
   - Each catcher has a fixed hue beneath it, red, green and yellow. The hues are Loppa tokens in
     `packages/tokens`, never brand-kit or status colours, and used only in the room.
   - Each catcher's name is always written, so colour is never the only signal.
   - The tools keep today's look once a catcher opens.
   - `DESIGN.md` and `docs/plan/DESIGN-LANGUAGE.md` gain these exceptions in the owner's words.
5. **The motion is CSS and inline SVG.**
   - A pausable float, a view-transition zoom (a cut where unsupported) and the catcher opening
     from `mark-geometry.ts`'s facets.
   - No animation library, and no frame gap over 25 ms when measured.
   - Nothing moves under `prefers-reduced-motion`. A click, a key or Escape always lands.
6. **Documents' four parts are links to the screens that do the work.**
   - Forms: the Akinator-style guided builder and manual mode.
   - Scan: bring in, and the page basics.
   - Sign.
   - Send.
   - Each screen carries a way back to the room.
   - A corner menu in the room holds sign-out, language, theme, Users, Brand and the To send count.
7. **The centre is the summary, decided separately.** A local, offline model's summary is ADR 0023,
   written with the measurements of spike S1. Until it exists, the centre says plainly that the
   summary is not on this computer yet; it never pretends.

## Consequences

- People arrive at the three tools, not at one product's list. Every older screen stays reachable
  inside Documents, or behind the switch the plan proposes for the earlier features.
- The room costs bundle headroom: 13.6 KB of the 1 000 KB total is left, and 4.0 KB of the
  stylesheet's 20. It is paid for, not raised.
- `DESIGN.md`'s palette gains its first non-status hues outside gold and grey, scoped to one
  screen.
- The two placeholders cost a float and a label each. Nothing else is built for them until
  Documents is finished.

## Not decided here

- The exact colours, the opening animation's drawing (code from the geometry, or a brand asset),
  and whether the intro becomes the spawn into the room: the owner's (`DOCUMENTS.md` §9).
- What happens to events, registrations, check-in, invoices, the ledger and Mailer: `DOCUMENTS.md`
  §5.
- The summary: ADR 0023.
