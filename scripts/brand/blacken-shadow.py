"""
A shadow is an absence of light, so it is black.

The brand bundle's renders bake their drop shadow as a warm grey — rgb(119, 111, 103) at alpha 39
in `still/loppa-1024.png` — chosen to sit on white. Alpha fixes the *background* on a dark page and
cannot fix that: over `#0e0e10` the grey composites as a pale smear under the mark, lightening
exactly where a shadow should darken. `build-animation-pack.py` learned this for the previous
palette; this does the same to the bundle's own frames rather than re-rendering the mark, because
the render is the identity and the shadow is not.

Shadow pixels are the semi-transparent ones with no metal in them (every channel under 140). The
mark's anti-aliased edges are semi-transparent too, but they carry gold or platinum and stay.
Black at alpha 14 lands where grey at 39 did over white, so the light page does not change.

    py -3 scripts/brand/blacken-shadow.py

Writes apps/forms/public/mark-loop-256.webp, mark-poster-256.png and mark-angled-256.png from
docs/brand/animation/loppa-256.webp and docs/brand/still/loppa-1024.png.
"""
from PIL import Image, ImageSequence

SRC_LOOP = "docs/brand/animation/loppa-256.webp"
SRC_STILL = "docs/brand/still/loppa-1024.png"
OUT = "apps/forms/public"


def blacken(frame: Image.Image) -> Image.Image:
    frame = frame.convert("RGBA")
    px = frame.load()
    w, h = frame.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if 0 < a < 250 and max(r, g, b) < 140:
                px[x, y] = (0, 0, 0, round(a * 14 / 39))
    return frame


still = blacken(Image.open(SRC_STILL)).resize((256, 256), Image.LANCZOS)
still.save(f"{OUT}/mark-poster-256.png", optimize=True)
still.save(f"{OUT}/mark-angled-256.png", optimize=True)

loop = Image.open(SRC_LOOP)
frames = [blacken(f) for f in ImageSequence.Iterator(loop)]
durations = [f.info.get("duration", loop.info.get("duration", 40)) for f in ImageSequence.Iterator(loop)]
frames[0].save(
    f"{OUT}/mark-loop-256.webp",
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    lossless=False,
    quality=85,
    method=6,
)
print(f"{len(frames)} frames; durations {min(durations)}–{max(durations)} ms")
