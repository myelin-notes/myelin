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
  var onFirstTouch: (() -> Void)?

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
    onFirstTouch?()
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
    // On the first touch rather than a timer: the JS listener only exists once the canvas mounts.
    var dumped = false
    probe.onFirstTouch = { [weak self] in
      if dumped { return }
      dumped = true
      let content = webview.scrollView.subviews.first { String(describing: type(of: $0)).contains("WKContentView") }
      for (label, view) in [("webview", webview as UIView?), ("content", content)] {
        let recognizers = (view?.gestureRecognizers ?? []).map { r -> String in
          "\(type(of: r))(\(r.isEnabled ? "on" : "off"))"
        }
        let interactions = (view?.interactions ?? []).map { "\(type(of: $0))" }
        try? self?.trigger("touchprobe", data: TouchProbeEvent(line: "\(label) recognizers: " + recognizers.joined(separator: ", ")))
        try? self?.trigger("touchprobe", data: TouchProbeEvent(line: "\(label) interactions: " + interactions.joined(separator: ", ")))
      }
    }

    // Scribble delays pencil touches while it decides whether they are handwriting for a text
    // field; opting the view out is the documented way to keep it off. TEMP until confirmed.
    if #available(iOS 14.0, *) {
      let scribble = UIScribbleInteraction(delegate: self)
      webview.addInteraction(scribble)
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

@available(iOS 14.0, *)
extension PencilPlugin: UIScribbleInteractionDelegate {
  func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
    return false
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
