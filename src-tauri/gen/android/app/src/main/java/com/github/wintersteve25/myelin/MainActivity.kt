package com.github.wintersteve25.myelin

import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
