# Media — photographs in the app

The app carries **four** photographs, each in an empty state, never in the room (the room is the owner's dark grey, ADR 0022). They are CC0 photographs of objects (paper, a pen, a typewriter); none shows a face. Each was fetched **once, at development time**, optimised and committed under `apps/forms/public/media/`; the app loads nothing from any other origin, and `scripts/media.test.ts` holds this file to the files (every file listed with its SHA-256, at most 120 KB each and 600 KB in all).

**Why greyscale:** the palette is gold and its greys and nothing else (`DESIGN.md`). A colour photograph would add a second hue to a page that has one; a grey one sits inside the palette and leaves gold to the buttons. In the dark theme the picture is dimmed (`filter: brightness(0.82)`).

**Why Wikimedia Commons:** the first choice was Unsplash, but its site answers a script with a bot check ("Making sure you're not a bot") and that is not bypassed. Wikimedia Commons has an open API and a licence per file; only files tagged **CC0** were taken, so no attribution is owed. One of the four started on Unsplash and was re-published on Commons under CC0; its Unsplash page is recorded below.

**To add or replace one:** fetch from a source whose licence needs no attribution (or add the attribution where it is shown), crop to 14:5, make it grey, resize to 1120 x 400, WebP, at most 120 KB; list the file here (source, author, licence, date, original size, SHA-256, alt key), add the alt key to all twelve catalogues, add a row to `THIRD-PARTY-NOTICES.md`, and add the name to `EmptyMedia` in `apps/forms/src/components/EmptyState.tsx`.

**Display:** `<img>` with `width`/`height` (1120 x 400, so the box is reserved and nothing shifts), `loading="lazy"`, `decoding="async"`, alt text from the catalogues. The only motion is a short fade-in, removed under `prefers-reduced-motion`.

**Total added:** 140732 bytes (137 KB) in the installer; nothing in the JavaScript bundle.

### `sign-pen.webp`

- **Used in:** Signing, empty list (`EmptyState` `media`). Alt text: key `media.alt.sign` (The nib of a fountain pen on paper), in all twelve catalogues.
- **Source:** <https://commons.wikimedia.org/wiki/File:Fountain-pen-1393979.jpg>
- **Author:** A_Different_Perspective. Originally on Pixabay (https://pixabay.com/fr/stylos-stylo-plume-charge-d-encre-1393979/); the Commons page tags it CC0.
- **Licence:** CC0 — <https://creativecommons.org/publicdomain/zero/1.0/deed.en>. No attribution required.
- **Retrieved:** 2026-10-20, through the Wikimedia Commons API (a 1280 px thumbnail), by a one-off script, never at runtime.
- **Original dimensions:** 3500 x 2333 px (taken 2016-05-15 15:44:21)
- **Made:** cropped to 14:5, resized to 1120 x 400, greyscale with an automatic contrast stretch, WebP quality 55; 31676 bytes.
- **SHA-256 of the committed file:** `a292eab2dc693795d98fd5379d3022501fe88256a9733ad728abe4f39d19e5a6`

### `send-plane.webp`

- **Used in:** To send, empty list (`EmptyState` `media`). Alt text: key `media.alt.send` (A paper plane held up over a city), in all twelve catalogues.
- **Source:** <https://commons.wikimedia.org/wiki/File:Paper_plane_(Unsplash).jpg>
- **Author:** Andrey  Larin engine9. Originally published on Unsplash (https://unsplash.com/photos/Kodkas71tT8); the Commons page tags it CC0. Both licences allow use in a product without attribution.
- **Licence:** CC0 — <https://creativecommons.org/publicdomain/zero/1.0/deed.en>. No attribution required.
- **Retrieved:** 2026-10-20, through the Wikimedia Commons API (a 1280 px thumbnail), by a one-off script, never at runtime.
- **Original dimensions:** 4719 x 3146 px (taken 2017-01-12)
- **Made:** cropped to 14:5, resized to 1120 x 400, greyscale with an automatic contrast stretch, WebP quality 55; 15156 bytes.
- **SHA-256 of the committed file:** `27ecb8fab24d615cbc57b4ca748f6007740cf0136ec1b8d4393e0f941974a177`

### `scan-pages.webp`

- **Used in:** Scan, no pages yet (`EmptyState` `media`). Alt text: key `media.alt.scan` (Stacked sheets of paper seen from the edge), in all twelve catalogues.
- **Source:** <https://commons.wikimedia.org/wiki/File:Texture_15.JPG>
- **Author:** Clara.Hoke. Own work, uploaded to Commons by the author.
- **Licence:** CC0 — <https://creativecommons.org/publicdomain/zero/1.0/deed.en>. No attribution required.
- **Retrieved:** 2026-10-20, through the Wikimedia Commons API (a 1280 px thumbnail), by a one-off script, never at runtime.
- **Original dimensions:** 1280 x 960 px (taken 2014-04-28 14:48:33)
- **Made:** cropped to 14:5, resized to 1120 x 400, greyscale with an automatic contrast stretch, WebP quality 55; 27146 bytes.
- **SHA-256 of the committed file:** `de6d0e278fc9b78d050245611f911d16489138cc6a430b7ff67651cc18631030`

### `forms-typewriter.webp`

- **Used in:** Forms, no forms yet (My forms) (`EmptyState` `media`). Alt text: key `media.alt.forms` (A typewriter with a sheet of paper in it), in all twelve catalogues.
- **Source:** <https://commons.wikimedia.org/wiki/File:Woodstock_typewriter,_1940s,_daylight.jpg>
- **Author:** Cbaile19. Own work, uploaded to Commons by the author.
- **Licence:** CC0 — <https://creativecommons.org/publicdomain/zero/1.0/deed.en>. No attribution required.
- **Retrieved:** 2026-10-20, through the Wikimedia Commons API (a 1280 px thumbnail), by a one-off script, never at runtime.
- **Original dimensions:** 3512 x 3064 px (taken 2021-02-17 10:34:30)
- **Made:** cropped to 14:5, resized to 1120 x 400, greyscale with an automatic contrast stretch, WebP quality 55; 66754 bytes.
- **SHA-256 of the committed file:** `3629251cc12fc3186c8952fe403599a16a2fb7b5c83cac3012302d6f0feab95d`

