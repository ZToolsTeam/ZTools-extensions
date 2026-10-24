import Foundation
import CoreImage
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for path in CommandLine.arguments.dropFirst() {
  guard let img = CIImage(contentsOf: URL(fileURLWithPath: path)) else { print("\(path)\tLOADFAIL"); continue }
  let f = detector.features(in: img).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
  let msg = f.first ?? "<<NONE>>"
  print("\(path)\t\(msg.data(using: .utf8)!.base64EncodedString())")
}
