"""Draws the STC Recorder icon (build/icon.png and the tray icons): a green record dot
inside a ring that is still being drawn. The vector master is design/logo.svg.
Run: python3 scripts/make-icons.py   (needs Pillow). The PNGs are committed."""
import math

from PIL import Image, ImageDraw

S = 1024  # supersampled canvas
K = S / 256  # the mark is designed on a 256 x 256 grid

INK = (5, 19, 32, 255)
GREEN = (1, 205, 152, 255)
AMBER = (250, 204, 21, 255)

RING_R, RING_W, DOT_R = 98, 26, 46  # centre-line radius and width of the ring, radius of the dot
GAP = (-90, -30)  # the ring is open from the top to 30 degrees above the right


def mark(d, ox, oy, scale, ring, dot):
    k = K * scale

    def p(x, y):
        return (ox + x * k, oy + y * k)

    outer = RING_R + RING_W / 2
    d.arc([*p(128 - outer, 128 - outer), *p(128 + outer, 128 + outer)], GAP[1], GAP[0] + 360, fill=ring, width=round(RING_W * k))
    for angle in GAP:  # round ends
        a = math.radians(angle)
        cx, cy = 128 + RING_R * math.cos(a), 128 + RING_R * math.sin(a)
        d.ellipse([*p(cx - RING_W / 2, cy - RING_W / 2), *p(cx + RING_W / 2, cy + RING_W / 2)], fill=ring)
    d.ellipse([*p(128 - DOT_R, 128 - DOT_R), *p(128 + DOT_R, 128 + DOT_R)], fill=dot)


def tile(size, ring=INK, dot=GREEN):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=(255, 255, 255, 255))
    scale = 0.74
    off = S * (1 - scale) / 2
    mark(d, off, off, scale, ring, dot)
    return img.resize((size, size), Image.LANCZOS)


tile(256).save('build/icon.png')
tile(32).save('src/assets/tray.png')
tile(32, GREEN, GREEN).save('src/assets/tray-rec.png')
tile(32, INK, AMBER).save('src/assets/tray-pause.png')
print('ok')
