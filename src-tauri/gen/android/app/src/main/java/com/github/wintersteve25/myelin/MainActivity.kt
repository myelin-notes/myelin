package com.github.wintersteve25.myelin

import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Contact arrives through dispatchTouchEvent, hover through dispatchGenericMotionEvent; both are
  // corrected before the WebView sees them. See StylusButtonShim.
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val corrected = StylusButtonShim.forWebView(event) ?: return true
    return super.dispatchTouchEvent(corrected)
  }

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    val corrected = StylusButtonShim.forWebView(event) ?: return true
    return super.dispatchGenericMotionEvent(corrected)
  }
}
