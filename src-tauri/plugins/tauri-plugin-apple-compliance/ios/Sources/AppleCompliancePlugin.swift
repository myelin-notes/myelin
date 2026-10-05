import AuthenticationServices
import Tauri
import UIKit
import WebKit

private struct WebAuthenticationArgs: Decodable {
  let url: String
  let callbackScheme: String
  let sessionId: String
}

private struct CancelWebAuthenticationArgs: Decodable {
  let sessionId: String
}

private struct WebAuthenticationResult: Encodable {
  let callbackUrl: String
}

class AppleCompliancePlugin: Plugin, ASWebAuthenticationPresentationContextProviding {
  private weak var webview: WKWebView?
  private var webAuthenticationSession: ASWebAuthenticationSession?
  private var webAuthenticationInvoke: Invoke?
  private var webAuthenticationID: String?

  @objc public override func load(webview: WKWebView) {
    self.webview = webview
  }

  @objc public func authenticateWeb(_ invoke: Invoke) {
    let args: WebAuthenticationArgs
    do {
      args = try invoke.parseArgs(WebAuthenticationArgs.self)
    } catch {
      invoke.reject("Invalid web authentication request.", error: error)
      return
    }

    guard let url = URL(string: args.url), ["http", "https"].contains(url.scheme?.lowercased()) else {
      invoke.reject("The authentication URL must use HTTP or HTTPS.")
      return
    }
    guard !args.callbackScheme.isEmpty else {
      invoke.reject("The authentication callback scheme is required.")
      return
    }
    guard !args.sessionId.isEmpty else {
      invoke.reject("The web authentication session ID is required.")
      return
    }

    DispatchQueue.main.async {
      guard self.webAuthenticationSession == nil else {
        invoke.reject("Another web authentication session is already active.")
        return
      }

      let id = args.sessionId
      let completion: ASWebAuthenticationSession.CompletionHandler = { [weak plugin = self] callbackUrl, error in
        DispatchQueue.main.async {
          plugin?.finishWebAuthentication(id: id, callbackUrl: callbackUrl, error: error)
        }
      }

      let session: ASWebAuthenticationSession
      if #available(iOS 17.4, *) {
        session = ASWebAuthenticationSession(
          url: url,
          callback: .customScheme(args.callbackScheme),
          completionHandler: completion)
      } else {
        session = ASWebAuthenticationSession(
          url: url,
          callbackURLScheme: args.callbackScheme,
          completionHandler: completion)
      }

      session.presentationContextProvider = self
      self.webAuthenticationSession = session
      self.webAuthenticationInvoke = invoke
      self.webAuthenticationID = id

      guard session.start() else {
        self.clearWebAuthentication()
        invoke.reject("The web authentication session could not start.")
        return
      }
    }
  }

  @objc public func cancelWebAuthentication(_ invoke: Invoke) {
    let args: CancelWebAuthenticationArgs
    do {
      args = try invoke.parseArgs(CancelWebAuthenticationArgs.self)
    } catch {
      invoke.reject("Invalid web authentication cancellation request.", error: error)
      return
    }

    DispatchQueue.main.async {
      guard self.webAuthenticationID == args.sessionId,
        let session = self.webAuthenticationSession
      else {
        invoke.resolve()
        return
      }

      let authenticationInvoke = self.webAuthenticationInvoke
      self.clearWebAuthentication()
      session.cancel()
      authenticationInvoke?.reject(
        "OAuth sign-in was cancelled.", code: "canceled")
      invoke.resolve()
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    if let window = webview?.window {
      return window
    }

    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow } ?? ASPresentationAnchor()
  }

  private func finishWebAuthentication(id: String, callbackUrl: URL?, error: Error?) {
    guard webAuthenticationID == id, let invoke = webAuthenticationInvoke else { return }
    clearWebAuthentication()

    if let error = error as? ASWebAuthenticationSessionError,
      error.code == .canceledLogin
    {
      invoke.reject("OAuth sign-in was cancelled.", code: "canceled")
      return
    }
    if let error = error {
      invoke.reject("Web authentication failed.", error: error)
      return
    }
    guard let callbackUrl = callbackUrl else {
      invoke.reject("Web authentication returned no callback URL.")
      return
    }

    invoke.resolve(WebAuthenticationResult(callbackUrl: callbackUrl.absoluteString))
  }

  private func clearWebAuthentication() {
    webAuthenticationSession = nil
    webAuthenticationInvoke = nil
    webAuthenticationID = nil
  }
}

@_cdecl("init_plugin_apple_compliance")
func initPlugin() -> Plugin {
  return AppleCompliancePlugin()
}
