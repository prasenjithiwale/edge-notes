#!/usr/bin/env python3
"""Generate the app and tray icons.

There is no image tooling on the build machine and checked-in binaries with no
source are a trap, so the icons are drawn here and regenerated with:

    python3 tools/make_icons.py

The mark is what the app actually looks like: a note panel with its tab on the
edge, and the three recent-colour dots from brief 6.5. The tray icon is a
monochrome template — macOS uses only its alpha, so it must be an outline, not a
silhouette, or it shows up as a black blob.
"""

import os
import struct
import zlib

# Brief 7.2 and 7.3.
ACCENT = (47, 111, 235, 255)
PANEL = (253, 243, 196, 255)
TAB = (255, 255, 255, 255)
# The palette's *text* colours, not its backgrounds: a pale dot on a white tab
# disappears at 32 px, which is where this icon spends most of its life.
DOTS = [(107, 36, 64, 255), (23, 63, 102, 255), (27, 82, 56, 255)]
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


def app_icon(size):
    """A note panel with its tab, on the accent ground."""
    c = Canvas(size)
    u = size / 100  # percentage units, so the drawing is resolution-independent

    c.rrect(0, 0, 100 * u, 100 * u, 22 * u, ACCENT)
    c.rrect(14 * u, 22 * u, 54 * u, 56 * u, 8 * u, PANEL)
    c.rrect(68 * u, 38 * u, 12 * u, 24 * u, 4 * u, TAB)

    # The three recent-note dots, only where they will not turn to mush.
    if size >= 64:
        for index, colour in enumerate(DOTS):
            c.circle(74 * u, (45 + index * 5) * u, 2.0 * u, colour)
    c.to_png_size = size
    return c


def tray_icon(size):
    """Monochrome template: an outlined panel with a solid tab on its edge."""
    c = Canvas(size)
    u = size / 100
    stroke = 9 * u

    c.rrect(6 * u, 18 * u, 62 * u, 64 * u, 14 * u, BLACK)
    c.clear_rrect(6 * u + stroke, 18 * u + stroke, 62 * u - stroke * 2, 64 * u - stroke * 2, 8 * u)
    c.rrect(72 * u, 36 * u, 16 * u, 28 * u, 6 * u, BLACK)
    return c


def write_ico(path, pngs):
    """A Windows .ico holding PNG entries, which Vista and later understand.

    Written by hand for the same reason as the PNGs: no image tooling here.
    """
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries, blobs = b"", b""
    for size, blob in pngs:
        entries += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0,
            0,
            1,
            32,
            len(blob),
            offset,
        )
        blobs += blob
        offset += len(blob)
    with open(path, "wb") as handle:
        handle.write(header + entries + blobs)


def main():
    root = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
    root = os.path.abspath(root)
    os.makedirs(root, exist_ok=True)

    sizes = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in sizes.items():
        app_icon(size).to_png(os.path.join(root, name), size)
        print("icon", name)

    # The .icns set macOS wants; iconutil turns the folder into the file.
    iconset = os.path.join(root, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    for name, size in {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }.items():
        app_icon(size).to_png(os.path.join(iconset, name), size)
        print("iconset", name)

    for name, size in {"tray.png": 22, "tray@2x.png": 44}.items():
        tray_icon(size).to_png(os.path.join(root, name), size)
        print("tray", name)

    # macOS turns the iconset folder into the .icns itself.
    if os.uname().sysname == "Darwin":
        os.system(f'iconutil -c icns "{iconset}" -o "{os.path.join(root, "icon.icns")}"')
        print("icns icon.icns")

    pngs = []
    for size in (16, 32, 48, 64, 128, 256):
        temp = os.path.join(root, f".ico-{size}.png")
        app_icon(size).to_png(temp, size)
        with open(temp, "rb") as handle:
            pngs.append((size, handle.read()))
        os.remove(temp)
    write_ico(os.path.join(root, "icon.ico"), pngs)
    print("ico icon.ico")


if __name__ == "__main__":
    main()
