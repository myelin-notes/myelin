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
