// Génère Recap.iconset (toutes les tailles macOS) à partir de icon.svg.
// Usage : swift mac/make-icon.swift mac/icon.svg <dossier>.iconset
import Cocoa

let args = CommandLine.arguments
guard args.count == 3, let image = NSImage(contentsOfFile: args[1]) else {
  FileHandle.standardError.write("Usage : make-icon.swift icon.svg sortie.iconset\n".data(using: .utf8)!)
  exit(1)
}
let out = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

for base in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let px = base * scale
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
    try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(name))
  }
}
