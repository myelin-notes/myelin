import Tauri
import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

struct GestureEvent: Encodable {
  let kind: String
  let action: String
  // Hover location in the webview's coordinate space (points); nil when the
  // pencil is out of hover range or the OS predates hover poses (< 17.5).
  let x: Double?
  let y: Double?
}

// TEMP: touch probe for the iPad fast-second-stroke investigation. Remove when done.
struct TouchProbeEvent: Encodable {
  let line: String
}

// Passive: never recognizes, never delays or cancels touches, only reports what UIKit delivers to
// the web view. Left in .possible so UIKit keeps sending every phase of the sequence.
class TouchProbeRecognizer: UIGestureRecognizer {
  var report: ((String) -> Void)?

  private func describe(_ phase: String, _ touches: Set<UITouch>, _ event: UIEvent?) {
    let parts = touches.map { t -> String in
      let kind: String
      switch t.type {
      case .pencil: kind = "pencil"
      case .direct: kind = "direct"
      case .indirect: kind = "indirect"
      case .indirectPointer: kind = "indirectPointer"
      @unknown default: kind = "other"
      }
      let p = t.location(in: view)
      return "\(kind)@\(Int(p.x)),\(Int(p.y)) f=\(String(format: "%.2f", t.force))"
    }
    let active = event?.allTouches?.count ?? -1
    report?("\(phase) [\(parts.joined(separator: " "))] active=\(active) t=\(Int((touches.first?.timestamp ?? 0) * 1000))")
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    describe("began", touches, event)
  }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {}
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    describe("ended", touches, event)
    failIfSequenceOver(event)
  }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    describe("cancelled", touches, event)
    failIfSequenceOver(event)
  }

  // Leaves nothing in .possible once the sequence is over, so no other recognizer can be waiting on it.
  private func failIfSequenceOver(_ event: UIEvent) {
    let live = (event.allTouches ?? []).contains { $0.phase != .ended && $0.phase != .cancelled }
    if !live {
      state = .failed
    }
  }
}

class PencilPlugin: Plugin {
  private var probe: TouchProbeRecognizer?

  @objc public override func load(webview: WKWebView) {
    let interaction = UIPencilInteraction()
    interaction.delegate = self
    webview.addInteraction(interaction)

    // TEMP probe, see TouchProbeRecognizer.
    let probe = TouchProbeRecognizer()
    probe.cancelsTouchesInView = false
    probe.delaysTouchesBegan = false
    probe.delaysTouchesEnded = false
    probe.report = { [weak self] line in
      try? self?.trigger("touchprobe", data: TouchProbeEvent(line: line))
    }
    webview.addGestureRecognizer(probe)
    self.probe = probe
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
      let content = webview.scrollView.subviews.first { String(describing: type(of: $0)).contains("WKContentView") }
      let names = (content?.gestureRecognizers ?? []).map { r -> String in
        "\(type(of: r))(\(r.isEnabled ? "on" : "off"))"
      }
      try? self?.trigger("touchprobe", data: TouchProbeEvent(line: "recognizers: " + names.joined(separator: ", ")))
    }
  }

  fileprivate func emit(kind: String, action: UIPencilPreferredAction, location: CGPoint?) {
    let name: String
    switch action {
    case .switchEraser: name = "switchEraser"
    case .switchPrevious: name = "switchPrevious"
    case .showColorPalette: name = "showColorPalette"
    case .showInkAttributes: name = "showInkAttributes"
    default:
      if #available(iOS 17.5, *), action == .showContextualPalette {
        name = "showContextualPalette"
      } else {
        // .ignore is the user opting out; .runSystemShortcut is the system's to run.
        return
      }
    }
    try? trigger(
      "gesture",
      data: GestureEvent(
        kind: kind, action: name,
        x: location.map { Double($0.x) }, y: location.map { Double($0.y) }))
  }
}

extension PencilPlugin: UIPencilInteractionDelegate {
  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    emit(kind: "doubleTap", action: UIPencilInteraction.preferredTapAction, location: nil)
  }

  // On 17.5+ the system calls this instead of pencilInteractionDidTap, adding the hover pose.
  @available(iOS 17.5, *)
  func pencilInteraction(
    _ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap
  ) {
    emit(
      kind: "doubleTap", action: UIPencilInteraction.preferredTapAction,
      location: tap.hoverPose?.location)
  }

  @available(iOS 17.5, *)
  func pencilInteraction(
    _ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze
  ) {
    guard squeeze.phase == .ended else { return }
    emit(
      kind: "squeeze", action: UIPencilInteraction.preferredSqueezeAction,
      location: squeeze.hoverPose?.location)
  }
}

@_cdecl("init_plugin_pencil")
func initPlugin() -> Plugin {
  return PencilPlugin()
}
