// Turn the full-bleed icon artwork into the app icon's master image.
//
//   swift tools/icon_master.swift tools/icon-source.png <out.png>
//
// The artwork (tools/icon-source.png, generated from the brief in
// docs/progress.md) is a square with no shape of its own. This clips it to
// Apple's icon grid — an 824 px rounded square centred in a 1024 px canvas,
// with a soft shadow in the transparent margin — which is what macOS expects
// and reads well on Windows and Linux too. `npm run tauri icon` then makes every
// size and format from the result. AppKit rather than an image library: there
// is no image tooling on the build machine, and this is the only step that
// needs any.
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let art = NSImage(contentsOfFile: args[1]) else {
  FileHandle.standardError.write("usage: icon_master.swift <artwork.png> <out.png>\n".data(using: .utf8)!)
  exit(1)
}

let canvas = 1024.0
let body = 824.0
let inset = (canvas - body) / 2
// Apple's corner is a continuous curve; a radius of 22.37% of the body is the
// usual circular approximation of it.
let radius = body * 0.2237

let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: Int(canvas), pixelsHigh: Int(canvas),
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high

let rect = NSRect(x: inset, y: inset + 4, width: body, height: body)
let shape = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)

// The shadow, drawn by filling the shape once with it switched on.
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowBlurRadius = 22
shadow.shadowOffset = NSSize(width: 0, height: -10)
shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
shadow.set()
NSColor.black.setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

// The artwork, clipped to the shape.
NSGraphicsContext.saveGraphicsState()
shape.addClip()
art.draw(in: rect, from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

// A hairline of light round the edge, as the system's own icons have.
NSColor.white.withAlphaComponent(0.18).setStroke()
let edge = NSBezierPath(roundedRect: rect.insetBy(dx: 1, dy: 1), xRadius: radius - 1, yRadius: radius - 1)
edge.lineWidth = 2
edge.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("wrote", args[2])
