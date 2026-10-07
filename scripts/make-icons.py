"""Draws the Starecorder microphone icon (build/icon.png and the tray icons).
Run: python3 scripts/make-icons.py   (needs Pillow). The PNGs are committed."""
from PIL import Image, ImageDraw

S = 1024  # supersampled canvas
K = S / 448  # the mic is designed on a 448 x 448 grid


def mic(d, ox, oy, scale, fill):
    k = K * scale

    def p(x, y):
        return (ox + x * k, oy + y * k)

    d.rounded_rectangle([*p(143, 28), *p(305, 290)], radius=81 * k, fill=fill)
    w = 26 * k
    # holder: half circle (centre 224,218, centre-line radius 114) with two upright arms
    d.arc([*p(97, 91), *p(351, 345)], 0, 180, fill=fill, width=int(w))
    for x in (110, 338):
        d.rounded_rectangle([*p(x - 13, 205), *p(x + 13, 245)], radius=13 * k, fill=fill)
    d.rectangle([*p(212, 330), *p(236, 392)], fill=fill)
    d.rounded_rectangle([*p(165, 390), *p(283, 418)], radius=14 * k, fill=fill)


def tile(size, badge=None):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=(255, 255, 255, 255))
    scale = 0.72
    off = S * (1 - scale) / 2
    mic(d, off, off, scale, (17, 17, 17, 255))
    if badge:
        r = S * 0.20
        cx, cy = S * 0.77, S * 0.77
        d.ellipse([cx - r - S * 0.03, cy - r - S * 0.03, cx + r + S * 0.03, cy + r + S * 0.03], fill=(255, 255, 255, 255))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=badge)
    return img.resize((size, size), Image.LANCZOS)


tile(256).save('build/icon.png')
tile(32).save('src/assets/tray.png')
tile(32, (230, 50, 50, 255)).save('src/assets/tray-rec.png')
tile(32, (240, 170, 30, 255)).save('src/assets/tray-pause.png')
print('ok')
