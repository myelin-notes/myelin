import Vision
import AppKit
import Foundation

@_cdecl("recognize_text_from_path")
func recognizeTextFromPath(_ pathPtr: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let path = String(cString: pathPtr)

    guard let image = NSImage(contentsOfFile: path),
          let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let cgImage = bitmap.cgImage else {
        return strdup("")
    }

    var resultText = ""

    let request = VNRecognizeTextRequest { request, error in
        guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
        resultText = observations
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try? handler.perform([request])

    return strdup(resultText)
}

@_cdecl("free_ocr_string")
func freeOcrString(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}
