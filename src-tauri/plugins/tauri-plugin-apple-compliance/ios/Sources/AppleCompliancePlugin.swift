import AppTrackingTransparency
import Tauri
import UIKit
import WebKit

struct TrackingAuthorization: Encodable {
  let status: String

  init(_ status: ATTrackingManager.AuthorizationStatus) {
    switch status {
    case .notDetermined: self.status = "notDetermined"
    case .restricted: self.status = "restricted"
    case .denied: self.status = "denied"
    case .authorized: self.status = "authorized"
    @unknown default: self.status = "restricted"
    }
  }
}

class AppleCompliancePlugin: Plugin {
  private var pendingRequests: [Invoke] = []
  private var requesting = false
  private var activeObserver: NSObjectProtocol?

  @objc public override func load(webview: WKWebView) {
    activeObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.requestIfActive()
    }
  }

  deinit {
    if let activeObserver = activeObserver {
      NotificationCenter.default.removeObserver(activeObserver)
    }
  }

  @objc public func getTrackingAuthorizationStatus(_ invoke: Invoke) {
    invoke.resolve(TrackingAuthorization(ATTrackingManager.trackingAuthorizationStatus))
  }

  @objc public func requestTrackingAuthorization(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.pendingRequests.append(invoke)
      self.requestIfActive()
    }
  }

  private func requestIfActive() {
    guard !pendingRequests.isEmpty, !requesting,
      UIApplication.shared.applicationState == .active
    else { return }

    let status = ATTrackingManager.trackingAuthorizationStatus
    guard status == .notDetermined else {
      resolveRequests(status)
      return
    }

    requesting = true
    ATTrackingManager.requestTrackingAuthorization { status in
      DispatchQueue.main.async {
        self.requesting = false
        self.resolveRequests(status)
      }
    }
  }

  private func resolveRequests(_ status: ATTrackingManager.AuthorizationStatus) {
    let requests = pendingRequests
    pendingRequests.removeAll()
    for invoke in requests {
      invoke.resolve(TrackingAuthorization(status))
    }
  }
}

@_cdecl("init_plugin_apple_compliance")
func initPlugin() -> Plugin {
  return AppleCompliancePlugin()
}
