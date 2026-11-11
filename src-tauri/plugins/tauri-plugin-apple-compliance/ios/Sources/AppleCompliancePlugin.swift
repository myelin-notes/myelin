import AuthenticationServices
import StoreKit
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

private struct PurchaseArgs: Decodable {
  let productId: String
}

private struct EntitlementArgs: Decodable {
  let productId: String
  /// Asks the App Store for this Apple ID's purchases first; this may show a sign-in sheet.
  let sync: Bool
}

private struct EntitlementResult: Encodable {
  let active: Bool
  /// The purchase's `originalID`, for the server to look up; nil when inactive.
  var transactionId: String? = nil
}

private struct StorefrontResult: Encodable {
  /// ISO 3166-1 alpha-3, e.g. "USA"; nil when the App Store is unreachable.
  let countryCode: String?
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

  @objc public func purchasePro(_ invoke: Invoke) {
    let args: PurchaseArgs
    do {
      args = try invoke.parseArgs(PurchaseArgs.self)
    } catch {
      invoke.reject("Invalid purchase request.", error: error)
      return
    }

    Task {
      do {
        guard let product = try await Product.products(for: [args.productId]).first else {
          invoke.reject("Pro is not available in the App Store right now.")
          return
        }
        // Cancelled and pending (Ask to Buy) purchases resolve inactive; a pending one
        // shows up in `currentEntitlements` once approved.
        guard case .success(let verification) = try await product.purchase(),
          case .verified(let transaction) = verification
        else {
          invoke.resolve(EntitlementResult(active: false))
          return
        }
        await transaction.finish()
        invoke.resolve(
          EntitlementResult(active: true, transactionId: String(transaction.originalID)))
      } catch {
        invoke.reject("The purchase failed.", error: error)
      }
    }
  }

  @objc public func proEntitlement(_ invoke: Invoke) {
    let args: EntitlementArgs
    do {
      args = try invoke.parseArgs(EntitlementArgs.self)
    } catch {
      invoke.reject("Invalid entitlement request.", error: error)
      return
    }

    Task {
      do {
        if args.sync {
          try await AppStore.sync()
        }
        for await result in Transaction.currentEntitlements {
          if case .verified(let transaction) = result,
            transaction.productID == args.productId,
            transaction.revocationDate == nil
          {
            invoke.resolve(
              EntitlementResult(active: true, transactionId: String(transaction.originalID)))
            return
          }
        }
        invoke.resolve(EntitlementResult(active: false))
      } catch {
        invoke.reject("Could not restore purchases.", error: error)
      }
    }
  }

  @objc public func storefront(_ invoke: Invoke) {
    Task {
      invoke.resolve(StorefrontResult(countryCode: await Storefront.current?.countryCode))
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
