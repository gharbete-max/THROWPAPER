"""
Animation pack.

Frame 0 is the logo mark exactly: flat, top-down, unlit, logo geometry.
It then morphs -- seam radius, mouth gap, fold height, lighting, shadow and
camera elevation all driven by one parameter u -- into the 3D fortune teller,
chomps, and folds back to the identical logo. Seamless either way.
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = "apps/forms/public"
ANI = OUT
os.makedirs(ANI, exist_ok=True)

# ---------------------------------------------------------------- palette ---
def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], float)

PAIRS = [(rgb("#6FB8A6"), rgb("#9CD2C3")), (rgb("#EF8874"), rgb("#F9AF9B"))] * 2
PAPER_BOT = rgb("#E4E0DA")
OCCLUDE   = rgb("#60607A")
CANVAS    = rgb("#F6F5F2")

LIGHT = np.array([0.30, -0.50, 0.81]); LIGHT /= np.linalg.norm(LIGHT)
SHEEN = np.array([-0.55, 0.35, 0.76]); SHEEN /= np.linalg.norm(SHEEN)

# ---------------------------------------------------------------- geometry --
SC = 1.45
TIP_R, TIP_Z     = 0.52 * SC, 0.44 * SC
SEAM_RC, SEAM_RO = 0.30 * SC, 0.52 * SC
SEAM_HC, SEAM_HO = 0.415 * SC, 0.02 * SC
GAP_A            = math.radians(27)
LOGO_SEAM_R      = 0.455 * SC          # the logo's own proportions
LOGO_GAP         = math.radians(6.5)
BOW, SUB         = 0.034, 7

AZ_LOGO = 225.0        # top-down azimuth that puts a tip straight up

def v(x, y, z=0.0): return np.array([float(x), float(y), float(z)])
def pol(az, r, z):  return v(r * math.cos(az), r * math.sin(az), z)
def lerp(a, b, t):  return a + (b - a) * t

def bez(t, x1, y1, x2, y2):
    if t <= 0: return 0.0
    if t >= 1: return 1.0
    u = t
    for _ in range(10):
        x = 3*(1-u)**2*u*x1 + 3*(1-u)*u*u*x2 + u**3
        dx = 3*(1-u)**2*x1 + 6*(1-u)*u*(x2-x1) + 3*u*u*(1-x2)
        if abs(dx) < 1e-9: break
        u = min(1.0, max(0.0, u - (x - t)/dx))
    return 3*(1-u)**2*u*y1 + 3*(1-u)*u*u*y2 + u**3

def unfurl(t): return bez(t, 0.22, 0.75, 0.05, 1.0)
def bite(t):   return bez(t, 0.58, 0.02, 0.42, 1.0)

class Panel:
    __slots__ = ("A", "P", "Q", "base")
    def __init__(self, A, P, Q, base): self.A, self.P, self.Q, self.base = A, P, Q, base

def scene(q, u):
    """u = 0 -> the logo, flat and unlit.  u = 1 -> the 3D fortune teller."""
    o = [q, 1 - q, q, 1 - q]
    tip_z = TIP_Z * u
    tips = [pol(math.pi/4 + math.pi/2*k, TIP_R, tip_z) for k in range(4)]
    seam = []
    for j in range(4):
        az = math.pi / 2 * j
        r = lerp(LOGO_SEAM_R, lerp(SEAM_RC, SEAM_RO, o[j]), u)
        z = lerp(0.0, lerp(SEAM_HC, SEAM_HO, o[j]), u)
        g = lerp(LOGO_GAP, GAP_A * o[j], u)
        seam.append((pol(az + g, r, z), pol(az - g, r, z)))
    OFF = v(0, 0, -tip_z * 0.5)
    a = OFF
    out = []
    for k in range(4):
        cd, cl = PAIRS[k]
        out.append(Panel(a, seam[k][0] + OFF, tips[k] + OFF, cd))
        out.append(Panel(a, tips[k] + OFF, seam[(k+1) % 4][1] + OFF, cl))
    return out

# ---------------------------------------------------------------- camera ----
class Cam:
    def __init__(self, az, el, dist, fov, W):
        a, e = math.radians(az), math.radians(el)
        self.pos = dist * np.array([math.cos(e)*math.cos(a), math.cos(e)*math.sin(a), math.sin(e)])
        f = -self.pos / np.linalg.norm(self.pos)
        r = np.cross(f, np.array([0, 0, 1.0])); r /= np.linalg.norm(r)
        self.f, self.r, self.u, self.fov, self.W = f, r, np.cross(r, f), fov, W

    def project(self, p):
        d = p - self.pos
        depth = float(np.dot(d, self.f))
        s = self.fov / max(depth, 0.05)
        return (self.W/2 + float(np.dot(d, self.r))*s*self.W/2,
                self.W/2 - float(np.dot(d, self.u))*s*self.W/2, depth)

# ---------------------------------------------------------------- raster ----
def _shade(buf, s0, s1, s2, c0, c1, c2, W):
    xs, ys = (s0[0], s1[0], s2[0]), (s0[1], s1[1], s2[1])
    x0, x1 = max(0, int(min(xs))), min(W, int(max(xs)) + 2)
    y0, y1 = max(0, int(min(ys))), min(W, int(max(ys)) + 2)
    if x1 <= x0 or y1 <= y0: return
    den = (s1[1]-s2[1])*(s0[0]-s2[0]) + (s2[0]-s1[0])*(s0[1]-s2[1])
    if abs(den) < 1e-9: return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    w0 = ((s1[1]-s2[1])*(xx-s2[0]) + (s2[0]-s1[0])*(yy-s2[1])) / den
    w1 = ((s2[1]-s0[1])*(xx-s2[0]) + (s0[0]-s2[0])*(yy-s2[1])) / den
    w2 = 1.0 - w0 - w1
    m = (w0 >= -0.004) & (w1 >= -0.004) & (w2 >= -0.004)
    if not m.any(): return
    col = w0[m][:, None]*c0 + w1[m][:, None]*c1 + w2[m][:, None]*c2
    tile = buf[y0:y1, x0:x1]
    tile[..., :3][m] = np.clip(col, 0, 255)
    tile[..., 3][m] = 255

def render(panels, cam, u, size, ss=4):
    W = size * ss
    buf = np.zeros((W, W, 4), np.float32)

    if u > 0.02:                                   # shadow fades in with the lift
        sh = Image.new("L", (W, W), 0)
        ds = ImageDraw.Draw(sh)
        for pn in panels:
            ds.polygon([cam.project(v(p[0]*1.02, p[1]*1.02, -0.95))[:2]
                        for p in (pn.A, pn.P, pn.Q)], fill=int(16 * u))
        a = (np.asarray(sh.filter(ImageFilter.GaussianBlur(max(1, int(16*ss*size/500)))))
             .astype(np.float32) / 255.0)
        # Black, not a light grey.
        #
        # This was [158, 150, 146] — a warm grey picked to sit on the cream canvas, which made the
        # shadow a *lighter* colour than any dark surface. Alpha fixes the background on a dark
        # theme and cannot fix that: the shadow composited as a pale smear under the mark,
        # lightening exactly where a shadow should darken.
        #
        # A shadow is an absence of light, so it is black and carries its weight in alpha. The
        # opacity moved 44 -> 16 to match: black at 16/255 over the cream canvas lands on the same
        # value the old grey did at 44 (231 of 246), so the light theme is unchanged to the eye,
        # and over #101413 it is imperceptible, which is what a shadow on a dark surface is.
        buf[..., :3] = np.array([0, 0, 0], np.float32)
        buf[..., 3] = a * 255.0

    order = sorted(panels, key=lambda p: -np.linalg.norm(cam.pos - (p.A+p.P+p.Q)/3))
    bow = BOW * u
    for pn in order:
        A, P, Q = pn.A, pn.P, pn.Q
        dP, dQ = P - A, Q - A
        n0 = np.cross(dP, dQ); nl = np.linalg.norm(n0)
        if nl < 1e-9: continue
        n0 /= nl
        if np.dot(n0, cam.pos - A) < 0:
            n0, base = -n0, PAPER_BOT
        else:
            base = pn.base
        pts, cols = {}, {}
        for i in range(SUB + 1):
            for j in range(SUB + 1 - i):
                uu, ww = i / SUB, j / SUB
                b = bow * 4 * uu * ww
                pos = A + dP*uu + dQ*ww + n0*b
                du, dw = dP + n0*(bow*4*ww), dQ + n0*(bow*4*uu)
                n = np.cross(du, dw); n /= max(np.linalg.norm(n), 1e-9)
                if np.dot(n, n0) < 0: n = -n
                view = cam.pos - pos; view /= max(np.linalg.norm(view), 1e-9)
                hv = LIGHT + view; hv /= np.linalg.norm(hv)
                spec = max(0.0, float(n @ hv)) ** 26
                r = uu + ww
                k = (0.878 + 0.132*max(0.0, float(n @ LIGHT))) * (0.872 + 0.152*r**0.62)
                unit = pos / max(np.linalg.norm(pos), 1e-6)
                k *= 1.0 + 0.055*float(unit @ SHEEN)
                k = 1.0 + (k - 1.0) * u                 # unlit at the logo pose
                c = base*k + (OCCLUDE - base*k) * (0.10*(1-r)**1.8 * u)
                pts[(i, j)] = cam.project(pos)
                cols[(i, j)] = np.clip(c + 255.0*spec*0.20*u, 0, 255)
        for i in range(SUB):
            for j in range(SUB - i):
                _shade(buf, pts[(i,j)], pts[(i+1,j)], pts[(i,j+1)],
                       cols[(i,j)], cols[(i+1,j)], cols[(i,j+1)], W)
                if i + j < SUB - 1:
                    _shade(buf, pts[(i+1,j)], pts[(i+1,j+1)], pts[(i,j+1)],
                           cols[(i+1,j)], cols[(i+1,j+1)], cols[(i,j+1)], W)

    img = Image.fromarray(np.clip(buf, 0, 255).astype(np.uint8), "RGBA")
    return img.resize((size, size), Image.LANCZOS)

# ---------------------------------------------------------------- timeline --
DIST = 5.1
FOV_LOGO, FOV_3D = 5.50, 4.35
EL_LOGO, EL_3D   = 89.0, 60.0
AZ_3D            = 390.0        # 225 -> 390 is a 165 deg settle into the pinch

def frame(q, u, az, el, fov, size):
    return render(scene(q, u), Cam(az, el, DIST, fov, size * 4), u, size)

def build_intro(size):
    fr = []
    for _ in range(5):                                   # rest on the logo
        fr.append(frame(1.0, 0.0, AZ_LOGO, EL_LOGO, FOV_LOGO, size))
    N = 28                                               # unfold
    for i in range(N):
        t = unfurl((i + 1) / N)
        fr.append(frame(1.0, t, lerp(AZ_LOGO, AZ_3D, t), lerp(EL_LOGO, EL_3D, t),
                        lerp(FOV_LOGO, FOV_3D, t), size))
    NC = 72                                              # one chomp, camera +180
    for i in range(NC):
        p = i / NC
        fr.append(frame(bite((1 + math.cos(2*math.pi*p))/2), 1.0,
                        AZ_3D + 180*p, EL_3D + 4.0*math.sin(2*math.pi*p),
                        FOV_3D, size))
    N = 24                                               # fold back to the logo
    for i in range(N):
        t = unfurl((i + 1) / N)
        fr.append(frame(1.0, 1 - t, lerp(AZ_3D + 180, AZ_LOGO + 180, t),
                        lerp(EL_3D, EL_LOGO, t), lerp(FOV_3D, FOV_LOGO, t), size))
    return fr

def build_loop(size, NC=72):
    fr = []
    for i in range(NC):
        p = i / NC
        fr.append(frame(bite((1 + math.cos(2*math.pi*p))/2), 1.0,
                        AZ_3D + 180*p, EL_3D + 4.0*math.sin(2*math.pi*p),
                        FOV_3D, size))
    return fr

# ---------------------------------------------------------------- export ----
def on_canvas(im):
    bg = Image.new("RGB", im.size, tuple(int(c) for c in CANVAS))
    bg.paste(im, (0, 0), im)
    return bg

def save_gif(frames, path, ms):
    seq = [on_canvas(f) for f in frames]
    strip = Image.new("RGB", (seq[0].width * 6, seq[0].height))
    for i, k in enumerate(range(0, len(seq), max(1, len(seq)//6))[:6]):
        strip.paste(seq[k], (i * seq[0].width, 0))
    pal = strip.quantize(colors=200, method=Image.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in seq]
    q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=0,
              optimize=True, disposal=1)

def save_webp(frames, path, ms):
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=ms,
                   loop=0, format="WEBP", quality=68, method=4, minimize_size=True, allow_mixed=True)

if __name__ == "__main__":
    """
    Regenerate the hero loop and its poster.

    Only the WebP is written. The GIFs in the original bundle exist because GIF has 1-bit
    transparency and therefore needs a `-dark` variant per surface; this file has a real alpha
    channel and the site serves one asset to both themes, so the fallbacks would be two more
    megabytes maintained for nothing.

    Sizes come from argv so a retina variant is one argument rather than an edit.
    """
    import sys, time

    sizes = [int(a) for a in sys.argv[1:]] or [256]
    for size in sizes:
        started = time.time()
        loop = build_loop(size)
        save_webp(loop, f"{ANI}/mark-loop-{size}.webp", 30)
        print(f"mark-loop-{size}.webp  {os.path.getsize(f'{ANI}/mark-loop-{size}.webp')//1024} KB"
              f"  {len(loop)} frames  {time.time()-started:.0f}s")

    # The poster is the logo pose itself — u = 0, unlit, no shadow — so it is rendered directly
    # rather than by building the whole intro to keep its first frame.
    poster = frame(1.0, 0.0, AZ_LOGO, EL_LOGO, FOV_LOGO, 256)
    poster.save(f"{ANI}/mark-poster-256.png")
    print("mark-poster-256.png", os.path.getsize(f"{ANI}/mark-poster-256.png")//1024, "KB")
