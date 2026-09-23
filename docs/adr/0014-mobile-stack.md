# ADR 0014 — The app: Capacitor around the existing web app, native only where it earns it

**Status:** proposed
**Date:** 2026-09-23

## Context

**No native app exists.** `apps/` holds `forms`, `api-forms`, `mailer`, `api-mailer`; there is no
`ios/`, `android/`, Expo or Capacitor project anywhere. What does exist:

- `apps/forms` is React + Vite with SSR and `vite-plugin-pwa` — installable today.
- The door (check-in) already scans QR codes with the browser camera and is **idempotent**
  (`START-HERE.md` made that a v0.1 requirement precisely so an offline scanner would be cheap).
- Paper capture already runs in the browser: manual corner handles + projective warp (`warp.ts`),
  tesseract.js OCR in a worker.
- `packages/tokens` already has a **native compiler** (`compile-native.ts`).
- Auth is bearer + refresh (rule 3), which native clients need.
- **The owner cannot test by hand** (`HANDOVER.md`, 2026-09-22): Playwright is the acceptance
  channel.

The brief wants web and app built side by side, the scanner and on-site check-in app-first,
everything else on both.

## Options

**React Native / Expo, sharing packages.** Shares `@tp/shared`, `@tp/i18n`, `@tp/calc` and the
native tokens; **re-implements every screen**. Best native feel, best camera and background
behaviour, first-class access to ML Kit / VisionKit document scanners. Cost: a second UI codebase
for one builder, and Playwright cannot drive it — acceptance would need Detox or Maestro plus
simulators, which the owner cannot run.

**Capacitor wrapping `apps/forms`.** The same React app, in a native shell, with native plugins
where the web is weak. Every screen is shared by construction; Playwright keeps covering almost all
of it. Weaker native feel, WebView quirks, and background sync is harder.

**PWA only.** Already works; no app-store presence; iOS camera and background limits bite at the
door, and there is no native document scanner.

## Recommendation: Capacitor, with two native plugins, and a stated exit

1. **`apps/mobile`** — a Capacitor project whose web assets are `apps/forms`' build. No second UI.
2. **Native where it earns it, and only there:**
   - **Document scanner:** the platform scanners — Google ML Kit Document Scanner (Android) and
     VisionKit `VNDocumentCameraViewController` (iOS) — give edge detection, perspective correction
     and clean-up on-device, which is the brief's "prefer on-device" requirement met by the OS. A
     community Capacitor plugin wraps both (ADR 0015 lists candidates); the existing manual-handle
     warp stays as the web and fallback path.
   - **Offline check-in store:** SQLite via a Capacitor plugin, holding the event's signed QR
     tokens and a queue of arrivals, synced through the existing idempotent endpoint. Idempotency
     is what makes the sync safe; it already exists.
   - **eID app-switch:** BankID/MitID same-device flows open the eID app by universal link and
     return by deep link; Capacitor's App plugin handles both.
3. **OCR stays on-device**: tesseract.js in the WebView today, ML Kit text recognition as a native
   upgrade if measured accuracy asks for it.
4. **Exit to React Native** if, after P4, either of these is measured: the scanner or the door is
   unusable in the WebView on a mid-range Android, or app-store review rejects a wrapped app. The
   shared packages and the API mean that exit is a UI rewrite, not a platform rewrite.

## Consequences

- The web app must stay usable at phone width and offline-tolerant where the app needs it — already
  true of the door; P4 extends it to the scanner.
- App-store accounts, signing certificates and privacy labels are owner tasks
  (`LAUNCH-CHECKLIST.md` §6).
- Native builds need macOS for iOS. The dev machine is Windows (`HANDOVER.md`); iOS builds go
  through CI (e.g. a hosted macOS runner) or a cloud build service — an owner cost decision.
