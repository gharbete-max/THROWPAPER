# Media — photographs in the app

The app carries **12** photographs: grey ones of paper and of a hand writing, and three gold abstracts. They sit in empty states and on the heads of screens, never in the room (the room is the owner's dark grey, ADR 0022). None shows a face. Each was chosen by the owner from Unsplash, fetched by hand **once**, graded and committed under `apps/forms/public/media/`; the app loads nothing from any other origin, and `scripts/media.test.ts` holds this file to the files (every file listed with its SHA-256, at most 120 KB each and 1.2 MB in all, and nothing in the folder that is not listed). The originals are not in the repository.

**The grade** (one for all, `scripts/media-process.py`): the palette is gold and its greys and nothing else (`DESIGN.md`). A colour photograph would add a second hue to a page that has one, so photographs are greyscale with a slight platinum tint, and the gold abstracts have their saturation cut and their hue moved to the brand gold, so gold is the only warm hue. In the dark theme a picture is dimmed (`filter: brightness(0.82)`); the one pair (`summary-light`, `summary-dark`) swaps with the theme instead.

**Licence:** the first round (#208) used four CC0 photographs from Wikimedia Commons because Unsplash answers a script with a bot check, which is not bypassed. All four were replaced in this round by photographs the owner picked from Unsplash and downloaded himself; the Commons files are no longer shipped. The Unsplash License is not an open-source licence, but it allows use in a product without permission or attribution; it does not allow selling the photograph on its own or building a competing photo service, which Loppa is not.

**To add or replace one:** add a row to `JOBS` in `scripts/media-process.py` (crop focus, size, grade), run it on the original, look at the result, then list the file here (source, photographer, licence, date, original size, SHA-256, alt key), add the alt key to all twelve catalogues, add the file to `MEDIA` in `apps/forms/src/lib/media.ts`, and to `THIRD-PARTY-NOTICES.md`, then run `python scripts/media-process.py --stats` (it rewrites `packages/tokens/src/media-stats.json`, which `media-contrast.test.ts` checks against each file's hash and holds a scrim or chip over a picture to 4.5:1 in both themes).

**Display:** `EmptyState` (`media`) and `Banner` draw an `<img>` with `width`/`height` (the box is reserved, nothing shifts), `loading="lazy"`, `decoding="async"`, alt text from the catalogues. A page banner is as wide as its column and at most 11 rem tall (a thin strip 5 rem); nothing is written over a picture, so there is no contrast to keep. The only motion is a short fade-in on an empty state, removed under `prefers-reduced-motion`.

**Total added:** 622278 bytes (608 KB) in the installer, replacing 140732 bytes of the first round; nothing in the JavaScript bundle.

### `scan-crane.webp`

- **Used in:** Scan, no pages yet (`EmptyState` `media`), 1120 x 400. Alt text: key `media.alt.scan` (A white paper crane), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/h8nqwrUpkwg>
- **Photographer:** Fer Troulik (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`fer-troulik-h8nqwrUpkwg-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4000 x 2667 px
- **Made:** by `scripts/media-process.py`: cropped to 1120 x 400 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 5752 bytes.
- **SHA-256 of the committed file:** `ccbb7a407bae593e98d9390fd2ec5ac4cd8940186f2cbcc6e5a2d624a4f49639`

### `sign-crane.webp`

- **Used in:** Signing, empty list (`EmptyState` `media`), 1120 x 400. Alt text: key `media.alt.sign` (A paper crane on a table), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/QR2w8DMgsbk>
- **Photographer:** Insung Yoon (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`insung-yoon-QR2w8DMgsbk-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4300 x 2867 px
- **Made:** by `scripts/media-process.py`: cropped to 1120 x 400 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 43406 bytes.
- **SHA-256 of the committed file:** `e8bdd8f186fba47f3618739bcef5544f45b41dc912dbeddc9996acb13f147e23`

### `forms-hand.webp`

- **Used in:** Forms, no forms yet (My forms) (`EmptyState` `media`), 1120 x 400. Alt text: key `media.alt.forms` (A hand writing on a sheet of paper), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/fTRZAC-uri4>
- **Photographer:** Masjid Maba (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`masjid-maba-fTRZAC-uri4-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4592 x 3448 px
- **Made:** by `scripts/media-process.py`: cropped to 1120 x 400 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 11372 bytes.
- **SHA-256 of the committed file:** `92d490acce6820e84ba851b890e49d20b499f701db049f12f9f78a423e0a90a1`

### `send-waves.webp`

- **Used in:** To send, empty list (`EmptyState` `media`), 1120 x 400. Alt text: key `media.alt.send` (Curling sheets of paper), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/zU51YjhibV4>
- **Photographer:** Alex Shuper (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`alex-shuper-zU51YjhibV4-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 7680 x 4320 px
- **Made:** by `scripts/media-process.py`: cropped to 1120 x 400 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 23124 bytes.
- **SHA-256 of the committed file:** `0b57d05af1c647a9cba4566ca56093ddb759ecc1292cfceaf1a3c5fdc0e427c0`

### `send-fortune.webp`

- **Used in:** Send, above the choice of three ways (`Banner`). Alt text: key `media.alt.fortune` (A folded paper fortune teller), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/AxUB4m3nDCE>
- **Photographer:** David Rodrigues (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`david-rodrigues-AxUB4m3nDCE-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4000 x 2248 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 11178 bytes.
- **SHA-256 of the committed file:** `09e263ce071d8c26c0b6675520fd0a77cbdba8951d439051ae62bcbb21898cf1`

### `sign-desk.webp`

- **Used in:** Signing, at the top of the new-request form (`Banner`). Alt text: key `media.alt.desk` (A hand signing a sheet of paper at a desk), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/r99-Kg4_MGU>
- **Photographer:** Signature Pro (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`signature-pro-r99-Kg4_MGU-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4560 x 5172 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 34116 bytes.
- **SHA-256 of the committed file:** `b08879a35403d7d0d6fba29b27714f46de854cfaa4be1caef95cca5443926c42`

### `keep-plane.webp`

- **Used in:** Scan, the panel that keeps the PDF (`Banner`); black, so the same in both themes. Alt text: key `media.alt.keep` (A sheet of paper crumpled, then folded into a plane), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/lRhedSIgeo0>
- **Photographer:** Joshua Dixon (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`joshua-dixon-lRhedSIgeo0-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 6240 x 4160 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 86; 15330 bytes.
- **SHA-256 of the committed file:** `323bf1932d25ad015fe9ecd4273238ddaad0950491ca39f6f25e00b915181c37`

### `gallery-foil.webp`

- **Used in:** Forms, the template gallery (`Banner`, thin strip). Alt text: key `media.alt.foil` (Crumpled gold foil), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/shLU6SZfIQY>
- **Photographer:** Kier In Sight Archives (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`kier-in-sight-archives-shLU6SZfIQY-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 2500 x 2500 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), a gold abstract: saturation cut by 30% and the hue moved halfway to the brand gold #cea85c, so gold is the only warm hue; WebP quality 14; 119906 bytes.
- **SHA-256 of the committed file:** `482e05f816e02a5fd3d8503353bcf6b5d30eef99cd1c54833dc4fb18b77a698c`

### `ai-streaks.webp`

- **Used in:** Summary, the head of the AI models card (`Banner`, thin strip); dark by nature. Alt text: key `media.alt.streaks` (Streaks of golden light), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/YeUVDKZWSZ4>
- **Photographer:** Rene Bohmer (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`rene-bohmer-YeUVDKZWSZ4-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4671 x 3114 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), a gold abstract: saturation cut by 30% and the hue moved halfway to the brand gold #cea85c, so gold is the only warm hue; WebP quality 86; 82058 bytes.
- **SHA-256 of the committed file:** `b31ecce19aafd98540d9e9be0666f946de8acbcb295edc72d1790c770a60b728`

### `models-blur.webp`

- **Used in:** Summary, the top of the "Full" model card (`Banner`, thin strip, decorative: `alt=""`). Alt text: key `media.alt.blur` (Soft golden light), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/20KJI8Cwl6A>
- **Photographer:** Philipp Hubert (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`philipp-hubert-20KJI8Cwl6A-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 5184 x 3456 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 240 (`width`/`height` on the image), a gold abstract: saturation cut by 30% and the hue moved halfway to the brand gold #cea85c, so gold is the only warm hue; WebP quality 86; 37406 bytes.
- **SHA-256 of the committed file:** `43f4f05193ff640cb66970de0323a9ccdb7e5e9236ffabfe66d9ef6c4f81ec2f`

### `summary-light.webp`

- **Used in:** Summary, the header in the light theme (`Banner`, with `summary-dark`). Alt text: key `media.alt.summary` (Liquid metal in ripples), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/9ZXx1z73SS8>
- **Photographer:** Logan Voss (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`logan-voss-9ZXx1z73SS8-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4320 x 7680 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 81; 119746 bytes.
- **SHA-256 of the committed file:** `b91868183984944a426a356d0472f6623d078b28e0d77f6966cdadfd792c63a5`

### `summary-dark.webp`

- **Used in:** Summary, the header in the dark theme (`Banner`, with `summary-light`). Alt text: key `media.alt.summary` (Liquid metal in ripples), in all twelve catalogues.
- **Source:** <https://unsplash.com/photos/hWrice16XYU>
- **Photographer:** Logan Voss (from the file name; Unsplash).
- **Licence:** Unsplash License — <https://unsplash.com/license>. Free to use in a product, no permission or attribution required; credited here and in `THIRD-PARTY-NOTICES.md` anyway.
- **Retrieved:** 2026-10-20, by the owner, by hand from unsplash.com; the original (`logan-voss-hWrice16XYU-unsplash.jpg`) is not in the repository.
- **Original dimensions:** 4320 x 7680 px
- **Made:** by `scripts/media-process.py`: cropped to 1600 x 600 (`width`/`height` on the image), greyscale through a gentle S-curve and a gradient map (near-neutral shadows, platinum highlights #c6cad1 to #eceef2); WebP quality 80; 118884 bytes.
- **SHA-256 of the committed file:** `e0be9c2960b0d2bd94e8d44af4cde9f085ecb215d2bb8bd8fd171215a3f654d6`

