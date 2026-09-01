import Tauri
import UIKit
import WebKit

struct GestureEvent: Encodable {
  let kind: String
  let action: String
  // Hover location in the webview's coordinate space (points); nil when the
  // pencil is out of hover range or the OS predates hover poses (< 17.5).
  let x: Double?
  let y: Double?
}

class PencilPlugin: Plugin {
  @objc public override func load(webview: WKWebView) {
    let interaction = UIPencilInteraction()
    interaction.delegate = self
    webview.addInteraction(interaction)
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
