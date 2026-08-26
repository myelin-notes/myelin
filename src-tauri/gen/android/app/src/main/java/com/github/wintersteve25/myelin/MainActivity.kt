package com.github.wintersteve25.myelin

import android.os.Bundle
import android.view.MotionEvent
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Temporary: pipes what the shim sees into the on-screen debug panel. Both
  // sides run on the UI thread, so the call needs no hop. Delete along with
  // PenDebugPanel.
  override fun onDestroy() {
    // The listener below captures this activity's WebView, and the shim is a
    // process-wide object that outlives it.
    StylusButtonShim.reset()
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    StylusButtonShim.onEvent = { line ->
      webView.evaluateJavascript(
        "window.__stylusNative && window.__stylusNative(${JSONObject.quote(line)})",
        null,
      )
    }
  }

  // Stylus events are corrected before the WebView ever sees them — contact
  // through dispatchTouchEvent, hover through dispatchGenericMotionEvent. A
  // replacement is left to the garbage collector rather than recycled, since
  // Chromium queues input events and may still be holding one after dispatch
  // returns. See StylusButtonShim.
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val corrected = StylusButtonShim.forWebView(event) ?: return true
    return super.dispatchTouchEvent(corrected)
  }

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    val corrected = StylusButtonShim.forWebView(event) ?: return true
    return super.dispatchGenericMotionEvent(corrected)
  }
}
