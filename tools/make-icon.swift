import AppKit

// Receipt with a torn bottom edge and a check mark, on the app's green.
// Run: swift tools/make-icon.swift  (writes icons/icon-{180,192,512}.png)
func rgb(_ h: UInt32) -> NSColor {
  NSColor(srgbRed: CGFloat((h >> 16) & 255) / 255, green: CGFloat((h >> 8) & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: 1)
}

func draw(_ size: CGFloat) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = size / 100
  rgb(0x2F6F5E).setFill()
  NSRect(x: 0, y: 0, width: size, height: size).fill()

  // paper
  let paper = NSBezierPath()
  let left = 27 * s, right = 73 * s, top = 84 * s, bottom = 20 * s
  paper.move(to: NSPoint(x: left, y: top))
  paper.line(to: NSPoint(x: right, y: top))
  paper.line(to: NSPoint(x: right, y: bottom))
  let teeth = 6
  let w = (right - left) / CGFloat(teeth)
  for i in 0..<teeth {
    let x = right - CGFloat(i) * w
    paper.line(to: NSPoint(x: x - w / 2, y: bottom + 5 * s))
    paper.line(to: NSPoint(x: x - w, y: bottom))
  }
  paper.close()
  rgb(0xFFFFFF).setFill()
  paper.fill()

  // lines of text
  rgb(0xBFD6CE).setFill()
  for (i, len) in [30.0, 22.0, 26.0].enumerated() {
    NSBezierPath(roundedRect: NSRect(x: 34 * s, y: (72 - Double(i) * 8) * s, width: len * s, height: 3.6 * s), xRadius: 1.8 * s, yRadius: 1.8 * s).fill()
  }
  // check mark
  let check = NSBezierPath()
  check.move(to: NSPoint(x: 38 * s, y: 40 * s))
  check.line(to: NSPoint(x: 46 * s, y: 32 * s))
  check.line(to: NSPoint(x: 62 * s, y: 50 * s))
  check.lineWidth = 6 * s
  check.lineCapStyle = .round
  check.lineJoinStyle = .round
  rgb(0x2F6F5E).setStroke()
  check.stroke()

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for size in [180, 192, 512] {
  try! draw(CGFloat(size)).write(to: URL(fileURLWithPath: "icons/icon-\(size).png"))
}
