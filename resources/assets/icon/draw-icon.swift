// Draws the app icon: a macOS rounded square in the brand gradient with a window whose
// sidebar holds the tabs, the product's one idea. Usage: swift draw-icon.swift <out.png>
import AppKit

// Exactly 1024 pixels: a bitmap context, not lockFocus (which draws at the screen's scale).
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let context = NSGraphicsContext.current!.cgContext

func rounded(_ rect: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}
func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

// Apple's grid: an 824-point body inset 100 points, with a soft shadow beneath.
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x101444, 0.35))
context.addPath(rounded(body, 186))
context.setFillColor(color(0x4a5cf0))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(rounded(body, 186))
context.clip()
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [color(0x7186ff), color(0x3b46d6)] as CFArray, locations: [0, 1])!
context.drawLinearGradient(gradient, start: CGPoint(x: 220, y: 924), end: CGPoint(x: 804, y: 100), options: [])
// A gentle light from the top edge.
let sheen = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [color(0xffffff, 0.18), color(0xffffff, 0)] as CFArray, locations: [0, 1])!
context.drawLinearGradient(sheen, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 600), options: [])
context.restoreGState()

// The window: a white card, its sidebar tinted, with tab rows and one selected.
let card = CGRect(x: 232, y: 282, width: 560, height: 460)
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: color(0x0b0e3a, 0.28))
context.addPath(rounded(card, 54))
context.setFillColor(color(0xffffff))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(rounded(card, 54))
context.clip()
let sidebar = CGRect(x: card.minX, y: card.minY, width: 196, height: card.height)
context.setFillColor(color(0xe6e9ff))
context.fill(sidebar)
// Window controls along the sidebar's top.
for (index, hex) in [UInt32(0xff6159), 0xffbd2e, 0x28c941].enumerated() {
    context.setFillColor(color(hex))
    context.fillEllipse(in: CGRect(x: card.minX + 36 + CGFloat(index) * 34, y: card.maxY - 58, width: 20, height: 20))
}
// Tab rows: the second is the one shown.
for row in 0..<4 {
    let rect = CGRect(x: card.minX + 26, y: card.maxY - 132 - CGFloat(row) * 64, width: 144, height: 40)
    context.addPath(rounded(rect, 14))
    context.setFillColor(row == 1 ? color(0x3b5bfd) : color(0xffffff, 0.95))
    context.fillPath()
}
// The page: a headline bar and two lines.
context.setFillColor(color(0xdfe3fb))
context.addPath(rounded(CGRect(x: sidebar.maxX + 44, y: card.maxY - 128, width: 250, height: 38), 12)); context.fillPath()
context.setFillColor(color(0xeef0fd))
context.addPath(rounded(CGRect(x: sidebar.maxX + 44, y: card.maxY - 196, width: 300, height: 26), 10)); context.fillPath()
context.addPath(rounded(CGRect(x: sidebar.maxX + 44, y: card.maxY - 244, width: 220, height: 26), 10)); context.fillPath()
context.restoreGState()

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("wrote", CommandLine.arguments[1])
