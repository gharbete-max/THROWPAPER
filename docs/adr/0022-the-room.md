# ADR 0022 — The room: three independent catchers, Documents first

**Status:** accepted 2026-10-07 by the owner ("Let's go!"), with `docs/plan/DOCUMENTS.md`
**Vision:** `docs/VISION.md` · **Plan:** `docs/plan/DOCUMENTS.md`

## Context

The owner re-set what Loppa is (`docs/VISION.md`). You arrive in an empty dark grey room, where
three cootie catchers float, each over one of Loppa's own colours made stronger: Documents,
Spreadsheets, and Presentation & planning. The three never link to or affect each other. Documents
opens into Forms, Scan, Sign and Send around a centre that summarises and translates, and it is
finished first. The other two are animated placeholders.

Today a signed-in person lands on `/events` (`App.tsx`). On the hosted edition `/` is the
server-rendered marketing site (`site/routes.ts`). On the desktop a hard load of `/` would
client-render that site.

Where this ADR says "by default", it records a default the owner accepted with the plan and may
change at any time (`DOCUMENTS.md` §9).

## Decision

1. **The room is `/room`** in `apps/forms`, full screen with no rail. By default it is on the
   desktop first, and on the hosted edition if it stays.
   - Sign-in, the app's `/` and every unknown path land there instead of on `/events`.
   - The public site keeps `/`.
2. **The three catchers are independent tools.** No catcher imports, calls or links to another.
   This is stricter than rule 1: the catchers share no contract at all. Inside Documents, Forms and
   Sign still talk only over `docs/CONTRACT.md` §5.
3. **The placeholders are honest.** Spreadsheets and Presentation & planning float, are named and
   say "Not built yet". By default they have no link, handler or import and are not focusable, and
   a test holds all of that.
4. **The look is the room's own.**
   - The room is dark grey: its own token, not the derived dark's near-black.
   - Beneath each catcher is one of **Loppa's own colours, made stronger** so it stands out against
     the grey (the owner's answer). By default gold is beneath Documents, platinum beneath
     Spreadsheets, and bronze beneath Presentation & planning.
   - The colours are Loppa tokens in `packages/tokens`, never status colours. Each reads at 3:1 or
     more against the room's grey, and a test holds that. Bronze as it is reads at 2.95:1 on a
     `#2a2a2e` grey, so it is lifted.
   - By default the colours are not brand-kit colours, appear only in the room, and the tools keep
     today's look once a catcher opens.
   - Each catcher's name is always written, so colour is never the only signal.
   - `DESIGN.md` and `docs/plan/DESIGN-LANGUAGE.md` gain these exceptions in the owner's words.
5. **The motion is CSS and inline SVG.**
   - A pausable float, a zoom that grows the opened catcher out of the pressed one (transform only,
     after spike S2 measured a view transition's snapshot holding frames for 66–100 ms), and the
     catcher opening from `mark-geometry.ts`'s facets.
   - No animation library, and no frame gap over 25 ms when measured.
   - Nothing moves under `prefers-reduced-motion`. A click, a key or Escape always lands.
6. **Documents' four parts are links to the screens that do the work.**
   - Forms: the Akinator-style guided builder and manual mode.
   - Scan: bring in, and (by default) the page basics.
   - Sign.
   - Send.
   - Each screen carries a way back to the room.
   - A corner of the room holds only what belongs to no catcher: language and sign-out. Users,
     Brand and the To send count stay inside Documents, so the room shows no catcher's state.
     Theme stays in the parts it changes, because the room is always dark grey.
7. **The centre is summary and translation, decided separately.** A local, offline model that
   summarises and translates in all twelve of Loppa's languages is ADR 0023, written with the
   measurements of spike S1. Until it exists, the centre says plainly that the summary is not on
   this computer yet. On an edition that has no summary, it says that instead. It never pretends.

## Consequences

- People arrive at the three tools, not at one product's list.
- By default every older screen stays reachable behind the switch the plan proposes
  (`DOCUMENTS.md` §5 B). Whether events, check-in and attendance (Presentation & planning's
  precursor) and the ledger (Spreadsheets') are kept, hidden, moved into those catchers when they
  are built, or retired is the owner's (`VISION.md` §10).
- The room costs bundle headroom: 13.6 KB of the 1 000 KB total is left, and 4.0 KB of the
  stylesheet's 20. It is paid for, not raised.
- `DESIGN.md`'s palette stays gold, its tiers and the greys. The room adds stronger values of
  three of them, scoped to one screen.
- The two placeholders cost a float and a label each. Nothing else is built for them until
  Documents is finished.

## Not decided here

- The exact grey and the exact stronger colours: set in phase 2 with the contrast test, in front of
  the owner.
- The opening animation's drawing (code from the geometry by default, or a brand asset), and
  whether the intro becomes the spawn into the room: `DOCUMENTS.md` §9.
- What happens to events, registrations, check-in, invoices, the ledger and Mailer: `DOCUMENTS.md`
  §5.
- The summary and translation: ADR 0023.
