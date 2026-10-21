"""
Repeatable grade for the photographs in apps/forms/public/media (docs/brand/MEDIA.md).

    python scripts/media-process.py <folder with the originals> [<out folder>]

Needs Pillow and numpy; neither is a dependency of the repository (the committed WebP files are
what matter, the tool is kept so the grade can be repeated). The originals are never copied in.

Grade: photographs go greyscale through a gentle S-curve and a gradient map (near-neutral shadows,
platinum highlights); the three gold abstracts keep gold, desaturated by 30% and nudged halfway to the
brand gold #cea85c, so gold is the only warm hue. Each file is cropped by focus (cx, cy as fractions
of the original, zoom 1 = the largest crop of that shape), resized, and saved as WebP at the highest
quality that stays under the byte budget.
"""
import colorsys, hashlib, io, json, os, sys
import numpy as np
from PIL import Image

BUDGET = 118 * 1024  # a file may be 120 KB; leave a little
GOLD_HUE = colorsys.rgb_to_hsv(0xCE / 255, 0xA8 / 255, 0x5C / 255)[0]
STOPS_X = [0.0, 0.5, 0.8, 1.0]
STOPS = np.array([[8, 9, 11], [123, 125, 130], [198, 202, 209], [236, 238, 242]], float)

# name, out, width, height, grade, cx, cy, zoom[, gamma: above 1 darkens the mids of a very pale photograph]
JOBS = [
    ("fer-troulik-h8nqwrUpkwg", "scan-crane", 1120, 400, "grey", 0.5, 0.36, 1.0, 1.7),
    ("insung-yoon-QR2w8DMgsbk", "sign-crane", 1120, 400, "grey", 0.48, 0.42, 1.9),
    ("masjid-maba-fTRZAC-uri4", "forms-hand", 1120, 400, "grey", 0.6, 0.3, 1.0),
    ("alex-shuper-zU51YjhibV4", "send-waves", 1120, 400, "grey", 0.5, 0.5, 1.0),
    ("david-rodrigues-AxUB4m3nDCE", "send-fortune", 1600, 600, "grey", 0.55, 0.6, 1.0),
    ("signature-pro-r99-Kg4_MGU", "sign-desk", 1600, 600, "grey", 0.5, 0.45, 1.0),
    ("joshua-dixon-lRhedSIgeo0", "keep-plane", 1600, 600, "grey", 0.5, 0.5, 1.0),
    ("kier-in-sight-archives-shLU6SZfIQY", "gallery-foil", 1600, 600, "gold", 0.5, 0.5, 1.0),
    ("rene-bohmer-YeUVDKZWSZ4", "ai-streaks", 1600, 600, "gold", 0.5, 0.45, 1.0),
    ("philipp-hubert-20KJI8Cwl6A", "models-blur", 1600, 240, "gold", 0.5, 0.5, 1.0),
    ("logan-voss-9ZXx1z73SS8", "summary-light", 1600, 600, "grey", 0.5, 0.3, 1.0),
    ("logan-voss-hWrice16XYU", "summary-dark", 1600, 600, "grey", 0.5, 0.3, 1.0),
]


def crop(im, w, h, cx, cy, zoom):
    W, H = im.size
    scale = min(W / w, H / h) / zoom  # source pixels per output pixel
    cw, ch = w * scale, h * scale
    x = min(max(cx * W - cw / 2, 0), W - cw)
    y = min(max(cy * H - ch / 2, 0), H - ch)
    return im.resize((w, h), Image.LANCZOS, box=(x, y, x + cw, y + ch))


def grey(im, gamma=1.0):
    a = (np.asarray(im.convert("L"), float) / 255) ** gamma
    a = np.clip((a - 0.5) * 1.12 + 0.5, 0, 1)  # gentle contrast
    a = a + 0.10 * a * (1 - a) * np.sign(a - 0.5)  # a touch of S
    a = np.clip(a, 0, 1)
    out = np.stack([np.interp(a, STOPS_X, STOPS[:, c]) for c in range(3)], -1)
    return Image.fromarray(out.astype("uint8"))


def gold(im):
    h, s, v = [np.asarray(c, float) / 255 for c in im.convert("HSV").split()]
    h = h + 0.5 * (GOLD_HUE - h)  # halfway to the brand gold
    s = s * 0.7
    return Image.merge("HSV", [Image.fromarray((x * 255).astype("uint8")) for x in (h, s, v)]).convert("RGB")


def save(im, path):
    lo, hi, best = 8, 86, None
    while lo <= hi:
        q = (lo + hi) // 2
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= BUDGET:
            best, lo = (q, buf.getvalue()), q + 1
        else:
            hi = q - 1
    open(path, "wb").write(best[1])
    return best[0], len(best[1])


def main(src, out):
    os.makedirs(out, exist_ok=True)
    record = {}
    for name, dest, w, h, kind, cx, cy, zoom, *gamma in JOBS:
        im = Image.open(os.path.join(src, name + "-unsplash.jpg")).convert("RGB")
        size = im.size
        im = crop(im, w, h, cx, cy, zoom)
        im = grey(im, *gamma) if kind == "grey" else gold(im)
        path = os.path.join(out, dest + ".webp")
        q, n = save(im, path)
        record[dest] = dict(source=name, original=list(size), width=w, height=h, quality=q, bytes=n,
                            sha256=hashlib.sha256(open(path, "rb").read()).hexdigest())
        print(dest, w, h, "q", q, n)
    print(json.dumps(record, indent=1), file=open(os.path.join(out, "record.json"), "w"))


def _luminance(rgb):
    """WCAG relative luminance of an (n, 3) array of 0-255 values, as packages/tokens/src/contrast.ts."""
    s = rgb / 255.0
    lin = np.where(s <= 0.03928, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
    return lin @ np.array([0.2126, 0.7152, 0.0722])


def stats(media="apps/forms/public/media", out="packages/tokens/src/media-stats.json"):
    """
    The brightest and the darkest pixel of each committed photograph, whole and in its bottom third,
    for packages/tokens/src/media-contrast.test.ts: the worst case text on a scrim or a chip meets.
    Read from the shipped WebP files (not the originals), keyed by their hash, so a changed picture
    makes the test fail until this is run again. No decision reads this: it only measures.

        python scripts/media-process.py --stats
    """
    record = {}
    for name in sorted(os.listdir(media)):
        if not name.endswith(".webp"):
            continue
        raw = open(os.path.join(media, name), "rb").read()
        im = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), float)
        height = im.shape[0]
        bands = {"whole": im, "bottom": im[int(height * 2 / 3):]}
        entry = dict(sha256=hashlib.sha256(raw).hexdigest(), width=im.shape[1], height=height, bands={})
        for band, pixels in bands.items():
            flat = pixels.reshape(-1, 3)
            lum = _luminance(flat)
            entry["bands"][band] = dict(
                brightest=[int(c) for c in flat[int(np.argmax(lum))]],
                darkest=[int(c) for c in flat[int(np.argmin(lum))]],
            )
        record[name] = entry
    with open(out, "w", newline="\n") as f:
        f.write(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print("wrote", out, len(record), "photographs")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--stats"]:
        stats()
    else:
        main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "apps/forms/public/media")
