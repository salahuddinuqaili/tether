#!/usr/bin/env python3
"""Generate the tether PWA icon set: a lowercase "t" monogram in accent green on the
near-black tile (DECISIONS O3 → real mark). Antialiased via 4x supersampling + LANCZOS
downscale. Requires Pillow (`pip install --break-system-packages pillow`). Re-run with
`python scripts/gen-icons.py`; the emitted PNGs are what the app ships.

Note the shapes are FULL SQUARES with no pre-rounded corners: iOS masks the
apple-touch-icon itself, and the maskable variant just insets the mark into the safe zone.
"""
import os

from PIL import Image, ImageDraw

BG = (10, 10, 10, 255)        # #0a0a0a
ACCENT = (0, 255, 102, 255)   # #00ff66
SS = 4                        # supersample factor


def _t_icon(size: int, maskable: bool = False) -> Image.Image:
    S = size * SS
    img = Image.new("RGBA", (S, S), BG)
    d = ImageDraw.Draw(img)

    # Inset the mark; maskable needs a bigger margin so the "t" sits inside the safe zone.
    m = (0.30 if maskable else 0.20) * S
    box = S - 2 * m                # the square the mark lives in
    cx = S / 2

    stroke = box * 0.17            # bold enough to read at ~120px on the home screen
    r = stroke / 2
    top = m                        # stem top (a short ascender above the crossbar)
    bot = S - m                    # stem bottom (baseline)

    # Vertical stem
    d.rounded_rectangle([cx - stroke / 2, top, cx + stroke / 2, bot], radius=r, fill=ACCENT)

    # Crossbar, sitting in the upper third
    cby = top + box * 0.26
    cb_half = box * 0.30
    d.rounded_rectangle(
        [cx - cb_half, cby - stroke / 2, cx + cb_half, cby + stroke / 2], radius=r, fill=ACCENT
    )

    # Foot: a short rightward tick at the baseline so it reads as a lowercase "t", not a "+"
    foot_len = box * 0.22
    d.rounded_rectangle(
        [cx - stroke / 2, bot - stroke, cx + stroke / 2 + foot_len, bot], radius=r, fill=ACCENT
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
    os.makedirs(out, exist_ok=True)
    targets = {
        "pwa-192.png": _t_icon(192),
        "pwa-512.png": _t_icon(512),
        "pwa-maskable-512.png": _t_icon(512, maskable=True),
        "apple-touch-icon-180.png": _t_icon(180),
    }
    for name, img in targets.items():
        path = os.path.join(out, name)
        img.save(path)
        print(f"wrote {name} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
