#!/usr/bin/env python3
"""Generate the menu-bar (tray) icon.

The app icon is not drawn here any more: it is artwork (tools/icon-source.png),
shaped by tools/icon_master.swift and cut into every size by `tauri icon` — see
the icon section of docs/progress.md. The tray icon stays drawn by hand, because
macOS shows it as a template (only its alpha counts) at 22 px, where generated
artwork turns to mush. Regenerate with:

    python3 tools/make_icons.py

It mirrors the app icon: a glass pane docked to the right, its tab on the left
edge, and at 2x the three recent-colour dots. An outline, not a silhouette, or a
template image shows up as a solid blob.
"""

import os
import struct
import zlib

BLACK = (0, 0, 0, 255)

SS = 4  # supersampling factor, for anti-aliasing by downsampling


class Canvas:
    def __init__(self, size):
        self.size = size * SS
        self.buf = bytearray(self.size * self.size * 4)

    def _blend(self, i, rgba):
        r, g, b, a = rgba
        if a == 255:
            self.buf[i : i + 4] = bytes((r, g, b, a))
            return
        sa = a / 255
        for k, c in enumerate((r, g, b)):
            self.buf[i + k] = round(c * sa + self.buf[i + k] * (1 - sa))
        self.buf[i + 3] = min(255, round(a + self.buf[i + 3] * (1 - sa)))

    def rrect(self, x, y, w, h, r, rgba):
        """Rounded rectangle, in units of the final (un-supersampled) icon."""
        x, y, w, h, r = (v * SS for v in (x, y, w, h, r))
        for py in range(max(0, int(y)), min(self.size, int(y + h))):
            for px in range(max(0, int(x)), min(self.size, int(x + w))):
                dx = min(px - x, x + w - 1 - px)
                dy = min(py - y, y + h - 1 - py)
                if dx < r and dy < r:
                    # Corner: inside only within the radius.
                    if (r - dx) ** 2 + (r - dy) ** 2 > r * r:
                        continue
                self._blend((py * self.size + px) * 4, rgba)

    def circle(self, cx, cy, radius, rgba):
        cx, cy, radius = cx * SS, cy * SS, radius * SS
        for py in range(max(0, int(cy - radius)), min(self.size, int(cy + radius) + 1)):
            for px in range(max(0, int(cx - radius)), min(self.size, int(cx + radius) + 1)):
                if (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius:
                    self._blend((py * self.size + px) * 4, rgba)

    def clear_rrect(self, x, y, w, h, r):
        """Punch a hole, so an outline is an outline rather than a filled shape."""
        x, y, w, h, r = (v * SS for v in (x, y, w, h, r))
        for py in range(max(0, int(y)), min(self.size, int(y + h))):
            for px in range(max(0, int(x)), min(self.size, int(x + w))):
                dx = min(px - x, x + w - 1 - px)
                dy = min(py - y, y + h - 1 - py)
                if dx < r and dy < r and (r - dx) ** 2 + (r - dy) ** 2 > r * r:
                    continue
                i = (py * self.size + px) * 4
                self.buf[i : i + 4] = b"\x00\x00\x00\x00"

    def to_png(self, path, out_size):
        """Box-downsample the supersampled buffer and write a PNG."""
        step = self.size // out_size
        rows = []
        for oy in range(out_size):
            row = bytearray()
            for ox in range(out_size):
                acc = [0, 0, 0, 0]
                for sy in range(step):
                    base = ((oy * step + sy) * self.size + ox * step) * 4
                    for sx in range(step):
                        i = base + sx * 4
                        alpha = self.buf[i + 3]
                        # Premultiply, so transparent pixels do not darken edges.
                        acc[0] += self.buf[i] * alpha
                        acc[1] += self.buf[i + 1] * alpha
                        acc[2] += self.buf[i + 2] * alpha
                        acc[3] += alpha
                samples = step * step
                a = acc[3] // samples
                if acc[3]:
                    row += bytes((acc[0] // acc[3], acc[1] // acc[3], acc[2] // acc[3], a))
                else:
                    row += b"\x00\x00\x00\x00"
            rows.append(bytes(row))

        raw = b"".join(b"\x00" + r for r in rows)
        write_png(path, out_size, out_size, raw)


def write_png(path, width, height, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


def tray_icon(size):
    """Monochrome template: an outlined pane, a solid tab on its left edge, and
    at 2x the three dots inside it."""
    c = Canvas(size)
    u = size / 100
    stroke = 9 * u

    c.rrect(30 * u, 18 * u, 64 * u, 64 * u, 14 * u, BLACK)
    c.clear_rrect(30 * u + stroke, 18 * u + stroke, 64 * u - stroke * 2, 64 * u - stroke * 2, 8 * u)
    c.rrect(17 * u, 34 * u, 16 * u, 32 * u, 7 * u, BLACK)
    if size >= 40:
        for index in range(3):
            c.circle(72 * u, (38 + index * 12) * u, 4.5 * u, BLACK)
    return c


def main():
    root = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
    root = os.path.abspath(root)
    os.makedirs(root, exist_ok=True)
    for name, size in {"tray.png": 22, "tray@2x.png": 44}.items():
        tray_icon(size).to_png(os.path.join(root, name), size)
        print("tray", name)


if __name__ == "__main__":
    main()
