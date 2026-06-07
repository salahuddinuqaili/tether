#!/usr/bin/env python3
"""Generate placeholder PWA icons (DECISIONS O3) with no third-party deps.

Draws a dark tile with an accent-green ring + center dot — a stand-in "tether"
mark. Replace with real brand assets later; re-run with `python3 scripts/gen-icons.py`.
"""
import os
import struct
import zlib

BG = (10, 10, 10, 255)        # #0a0a0a
ACCENT = (0, 255, 102, 255)   # #00ff66


def _png(width: int, height: int, raw: bytes) -> bytes:
    def chunk(typ: bytes, data: bytes) -> bytes:
        body = typ + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def _icon(size: int, maskable: bool = False) -> bytes:
    cx = cy = size / 2
    radius = size * (0.28 if maskable else 0.34)  # keep within maskable safe zone
    thickness = size * 0.075
    dot = size * 0.085
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter: none
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = (dx * dx + dy * dy) ** 0.5
            on_ring = abs(dist - radius) <= thickness / 2
            in_dot = dist <= dot
            rows += bytes(ACCENT if (on_ring or in_dot) else BG)
    return _png(size, size, bytes(rows))


def main() -> None:
    out = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
    os.makedirs(out, exist_ok=True)
    targets = {
        "pwa-192.png": _icon(192),
        "pwa-512.png": _icon(512),
        "pwa-maskable-512.png": _icon(512, maskable=True),
        "apple-touch-icon-180.png": _icon(180),
    }
    for name, data in targets.items():
        with open(os.path.join(out, name), "wb") as fh:
            fh.write(data)
        print(f"wrote {name} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
