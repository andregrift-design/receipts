import AppKit

// VH5 icon: the silhouette from Viola's invoice (black on white) above the invoice's black bar with "VH5".
// tools/silhouette-mask.png is the figure's mask from the invoice PDF (white = figure).
// Run from the project folder: swift tools/make-icon.swift  (writes icons/icon-{180,192,512}.png)

let mask = NSImage(contentsOfFile: "tools/silhouette-mask.png")!
var rect = NSRect(origin: .zero, size: mask.size)
let maskCG = mask.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
// Head to waist: top 1080 px of the 1024 x 1536 mask.
let crop = maskCG.cropping(to: CGRect(x: 0, y: 0, width: 1024, height: 1080))!

func draw(_ size: CGFloat) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let g = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = g
  let ctx = g.cgContext
  let s = size / 100

  NSColor.white.setFill()
  NSRect(x: 0, y: 0, width: size, height: size).fill()

  // Black bar along the bottom, as on the invoice.
  let bar = 24 * s
  NSColor.black.setFill()
  NSRect(x: 0, y: 0, width: size, height: bar).fill()

  // Silhouette standing on the bar, a little left of center like on the invoice.
  let h = 72 * s
  let w = h * 1024 / 1080
  let figure = CGRect(x: 8 * s, y: bar - 1, width: w, height: h)
  ctx.saveGState()
  ctx.clip(to: figure, mask: crop)
  ctx.setFillColor(NSColor.black.cgColor)
  ctx.fill(figure)
  ctx.restoreGState()

  // "VH5" in the bar.
  let font = NSFont.systemFont(ofSize: 15 * s, weight: .heavy)
  let text = NSAttributedString(string: "VH5", attributes: [.font: font, .foregroundColor: NSColor.white, .kern: 1.2 * s])
  let t = text.size()
  text.draw(at: NSPoint(x: size - t.width - 7 * s, y: (bar - t.height) / 2))

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for size in [180, 192, 512] {
  try! draw(CGFloat(size)).write(to: URL(fileURLWithPath: "icons/icon-\(size).png"))
}
