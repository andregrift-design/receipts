import AppKit

// Icons and background art for VH5, from Viola's icon design (tools/icon-design.webp: a cream rounded square
// with the silhouette, on white). Run from the project folder: swift tools/make-icon.swift
//  - icons/icon-{180,192,512,1024}.png: the figure on cream, square and full bleed (iOS and macOS round the corners).
//  - icons/silhouette.png: the figure alone, transparent, for the faint background of the app.

// Load the design as raw RGBA bytes.
let design = NSImage(contentsOfFile: "tools/icon-design.webp")!
var rect = NSRect(origin: .zero, size: design.size)
let cg = design.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let W = cg.width, H = cg.height
var px = [UInt8](repeating: 0, count: W * H * 4)
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let rgba = CGImageAlphaInfo.premultipliedLast.rawValue
CGContext(data: &px, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: space, bitmapInfo: rgba)!
  .draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
// Bytes are stored top row first.
func at(_ x: Int, _ y: Int) -> Int { (min(max(y, 0), H - 1) * W + min(max(x, 0), W - 1)) * 4 }
func isCream(_ i: Int) -> Bool { let r = Int(px[i]), b = Int(px[i + 2]); return r > 236 && r < 254 && r - b > 6 }

// The cream square inside the design (measured: x 72..1182, y 62..1163); a centred 1101 px square of it.
let cropX = 76, cropY = 62, side = 1101

// The figure alone: black with alpha (everything light becomes transparent). Used for the icon and the app background.
var fig = [UInt8](repeating: 0, count: side * side * 4)
for y in 0..<side {
  for x in 0..<side {
    let s = at(cropX + x, cropY + y)
    let lum = (Int(px[s]) * 3 + Int(px[s + 1]) * 6 + Int(px[s + 2])) / 10
    let a = max(0, min(255, (150 - lum) * 255 / 110))   // the figure is pure black; grey shadow and cream become transparent
    let d = (y * side + x) * 4
    fig[d + 3] = UInt8(a)                               // premultiplied black: colour stays 0
  }
}
let figImage = CGContext(data: &fig, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: space, bitmapInfo: rgba)!.makeImage()!
// Square icon: the figure from the design on a clean cream gradient in the design's colours (top to bottom),
// full bleed; iOS and macOS round the corners themselves.
let icon = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: rgba)!
let cream = CGGradient(colorsSpace: space, colors: [
  CGColor(srgbRed: 251 / 255, green: 246 / 255, blue: 239 / 255, alpha: 1),
  CGColor(srgbRed: 239 / 255, green: 228 / 255, blue: 215 / 255, alpha: 1)] as CFArray, locations: [0, 1])!
icon.drawLinearGradient(cream, start: CGPoint(x: 0, y: side), end: CGPoint(x: 0, y: 0), options: [])
icon.draw(figImage, in: CGRect(x: 0, y: 0, width: side, height: side))
let iconImage = icon.makeImage()!

func png(_ image: CGImage, _ size: Int, _ path: String) {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: rgba)!
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}
for size in [180, 192, 512, 1024] { png(iconImage, size, "icons/icon-\(size).png") }
png(figImage, 900, "icons/silhouette.png")
