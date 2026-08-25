package com.github.wintersteve25.myelin

import android.view.MotionEvent

/**
 * Native half of the stylus-button contract.
 *
 * The web layer erases while `PointerEvent.buttons` carries the eraser bit
 * (32, Pointer Events L3) — see `syncEraserOverride` in drawable-canvas.ts.
 * Every platform whose WebView hides a stylus button from that reading needs a
 * shim like this one, whose whole job is to produce that bit. The web layer
 * stays platform-neutral; each platform gets one file that answers the same
 * question: what should the WebView have seen?
 *
 * Android hides it in a particular way. Chromium reads BUTTON_STYLUS_PRIMARY
 * as a right-click: it swallows the entire pointer stream while the button is
 * held — no contact, no moves reach JS at all — and emits a lone `contextmenu`
 * on release. So the button can't be observed, and nothing can be drawn while
 * it is down. Handing the WebView the same gesture as an eraser-tipped stylus
 * with no button pressed sidesteps that: the stream flows normally, and
 * Chromium reports the eraser bit the web layer is already looking for.
 *
 * An Apple Pencil has no barrel button; its equivalent (squeeze, double-tap)
 * arrives through UIPencilInteraction rather than in the touch stream, so an
 * iOS shim can't rewrite an event in place the way this one does. It has to
 * carry the same state across by whatever means UIKit allows, and produce that
 * same eraser bit on the other side.
 */
object StylusButtonShim {
  /**
   * The event to hand the WebView in place of [event].
   *
   * Returns [event] itself when there is nothing to correct, a replacement the
   * caller must recycle after dispatching, or null for an event that must not
   * be delivered at all.
   */
  fun forWebView(event: MotionEvent): MotionEvent? {
    if (!hasStylusButton(event)) {
      return event
    }
    // Button press/release carry no movement of their own and exist only to
    // announce the button — which is the announcement Chromium turns into a
    // right-click. Nothing downstream needs them.
    val action = event.actionMasked
    if (action == MotionEvent.ACTION_BUTTON_PRESS ||
        action == MotionEvent.ACTION_BUTTON_RELEASE) {
      return null
    }
    return asEraser(event)
  }

  private fun hasStylusButton(event: MotionEvent): Boolean {
    if (event.getToolType(0) != MotionEvent.TOOL_TYPE_STYLUS) {
      return false
    }
    // On release the button is already out of buttonState, so the event that
    // reports it names it in actionButton instead.
    val buttons = event.buttonState or event.actionButton
    return (buttons and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
  }

  /**
   * The same gesture, as an eraser-tipped stylus with no button pressed.
   *
   * Batched samples are carried over rather than dropped: the eraser tests a
   * point per sample without interpolating between them, so a fast stroke
   * thinned to one sample a frame erases in dashes.
   */
  private fun asEraser(event: MotionEvent): MotionEvent {
    val count = event.pointerCount
    val properties = Array(count) { i ->
      MotionEvent.PointerProperties().also {
        event.getPointerProperties(i, it)
        it.toolType = MotionEvent.TOOL_TYPE_ERASER
      }
    }
    val history = event.historySize
    val rewritten = MotionEvent.obtain(
      event.downTime,
      if (history > 0) event.getHistoricalEventTime(0) else event.eventTime,
      event.action,
      count,
      properties,
      coordsAt(event, count, if (history > 0) 0 else CURRENT),
      event.metaState,
      0,
      event.xPrecision,
      event.yPrecision,
      event.deviceId,
      event.edgeFlags,
      event.source,
      event.flags,
    )
    for (position in 1 until history) {
      rewritten.addBatch(
        event.getHistoricalEventTime(position),
        coordsAt(event, count, position),
        event.metaState,
      )
    }
    if (history > 0) {
      rewritten.addBatch(event.eventTime, coordsAt(event, count, CURRENT), event.metaState)
    }
    return rewritten
  }

  private const val CURRENT = -1

  private fun coordsAt(event: MotionEvent, count: Int, position: Int) =
    Array(count) { i ->
      MotionEvent.PointerCoords().also {
        if (position == CURRENT) {
          event.getPointerCoords(i, it)
        } else {
          event.getHistoricalPointerCoords(i, position, it)
        }
      }
    }
}
