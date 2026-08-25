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
  // through dispatchTouchEvent, hover through dispatchGenericMotionEvent. See
  // StylusButtonShim.
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val corrected = StylusButtonShim.forWebView(event) ?: return true
    if (corrected === event) {
      return super.dispatchTouchEvent(event)
    }
    return try {
      super.dispatchTouchEvent(corrected)
    } finally {
      corrected.recycle()
    }
  }

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    val corrected = StylusButtonShim.forWebView(event) ?: return true
    if (corrected === event) {
      return super.dispatchGenericMotionEvent(event)
    }
    return try {
      super.dispatchGenericMotionEvent(corrected)
    } finally {
      corrected.recycle()
    }
  }
}
