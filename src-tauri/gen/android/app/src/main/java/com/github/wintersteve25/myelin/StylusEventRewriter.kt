package com.github.wintersteve25.myelin

import android.view.InputDevice
import android.view.MotionEvent

/**
 * Rewrites stylus MotionEvents so a barrel button reaches the WebView as an eraser.
 *
 * Chromium reads a stylus button as a right-click: it swallows the whole pointer stream while the
 * button is held — no contact, no moves reach JS — and emits a lone `contextmenu` on release, so
 * nothing can be drawn or observed while it is down. Handing the WebView the same gesture as an
 * eraser-tipped stylus with no button pressed sidesteps that, and produces the `buttons` eraser bit
 * (32) the web layer already erases on — see `syncEraserOverride` in drawable-canvas.ts.
 */
object StylusEventRewriter {
  /**
   * The tool type every stylus pointer must report for the contact in progress, or
   * TOOL_TYPE_UNKNOWN between contacts.
   *
   * Chromium ties a pointer's identity to its tool type, so changing it mid-gesture strands the
   * pointer the contact started with: no pointerup ever arrives, and palm rejection is left
   * believing the pen never left the glass. So it is pinned when the pen lands — against the button
   * changing underneath it, and against devices that change their own reading while one is held.
   */
  private var contactToolType = MotionEvent.TOOL_TYPE_UNKNOWN

  /**
   * The event to hand the WebView in place of [event].
   *
   * Returns [event] itself when there is nothing to correct, a replacement to
   * dispatch in its place, or null for an event that must not be delivered at
   * all. The replacement must NOT be recycled: Chromium may still hold it
   * after dispatch returns.
   */
  fun forWebView(event: MotionEvent): MotionEvent? {
    // The touchscreen reports fingers on a stream of their own, separate from the pen digitizer's.
    if (!isFromStylus(event)) {
      return event
    }
    val hasButton = hasStylusButton(event)
    val action = event.actionMasked

    if (action == MotionEvent.ACTION_BUTTON_PRESS ||
        action == MotionEvent.ACTION_BUTTON_RELEASE) {
      // These carry no movement and exist only to announce the button — the announcement Chromium
      // turns into a right-click.
      return if (hasButton) null else event
    }

    if (isStylusDown(event, action)) {
      contactToolType =
        if (hasButton) MotionEvent.TOOL_TYPE_ERASER else stylusToolType(event)
    }
    // Between contacts nothing is pinned, so the button alone decides and a hovering pen with it
    // held previews as the eraser.
    val toolType = when {
      contactToolType != MotionEvent.TOOL_TYPE_UNKNOWN -> contactToolType
      hasButton -> MotionEvent.TOOL_TYPE_ERASER
      else -> MotionEvent.TOOL_TYPE_UNKNOWN
    }
    if (isStylusUp(event, action) || action == MotionEvent.ACTION_CANCEL) {
      contactToolType = MotionEvent.TOOL_TYPE_UNKNOWN
    }

    // A button pressed mid-stroke can no longer change the tool type, but it still has to be
    // hidden, or Chromium starts its right-click on the spot.
    val rewriting = hasButton || disagreesWith(event, toolType)
    return if (rewriting) rebuilt(event, toolType) else event
  }

  private fun isStylusDown(event: MotionEvent, action: Int) =
    action == MotionEvent.ACTION_DOWN ||
      (action == MotionEvent.ACTION_POINTER_DOWN &&
        isStylusPointer(event.getToolType(event.actionIndex)))

  private fun isStylusUp(event: MotionEvent, action: Int) =
    action == MotionEvent.ACTION_UP ||
      (action == MotionEvent.ACTION_POINTER_UP &&
        isStylusPointer(event.getToolType(event.actionIndex)))

  /** The tool type of the first stylus pointer, for pinning at contact. */
  private fun stylusToolType(event: MotionEvent): Int {
    for (i in 0 until event.pointerCount) {
      val toolType = event.getToolType(i)
      if (isStylusPointer(toolType)) {
        return toolType
      }
    }
    return MotionEvent.TOOL_TYPE_UNKNOWN
  }

  /** Whether any stylus pointer reports something other than [toolType]. */
  private fun disagreesWith(event: MotionEvent, toolType: Int): Boolean {
    if (toolType == MotionEvent.TOOL_TYPE_UNKNOWN) {
      return false
    }
    for (i in 0 until event.pointerCount) {
      val reported = event.getToolType(i)
      if (isStylusPointer(reported) && reported != toolType) {
        return true
      }
    }
    return false
  }

  /**
   * Any button but the tip's own, on anything that came from a stylus.
   *
   * Which bit a barrel press lands on isn't worth predicting: BUTTON_SECONDARY and
   * BUTTON_STYLUS_PRIMARY are both in use across vendors, and a device may swap in a later
   * firmware. So all are treated alike but BUTTON_PRIMARY, which some devices set for the tip
   * itself and which would turn every ordinary stroke into an erase. Gating on input source for
   * the same reason: the tool type is one of the things a device may misreport while a button is
   * held.
   *
   * BUTTON_TERTIARY is in the mask, so a second barrel button erases here rather than opening the
   * tool wheel as it does elsewhere. Narrowing it needs a device to say which bit its barrel uses.
   */
  private fun hasStylusButton(event: MotionEvent): Boolean {
    if (!isFromStylus(event)) {
      return false
    }
    // On release the button is already out of buttonState; that event names it in actionButton.
    val buttons = event.buttonState or event.actionButton
    return (buttons and MotionEvent.BUTTON_PRIMARY.inv()) != 0
  }

  private fun isFromStylus(event: MotionEvent): Boolean {
    if ((event.source and InputDevice.SOURCE_STYLUS) == InputDevice.SOURCE_STYLUS) {
      return true
    }
    for (i in 0 until event.pointerCount) {
      if (isStylusPointer(event.getToolType(i))) {
        return true
      }
    }
    return false
  }

  private fun isStylusPointer(toolType: Int) =
    toolType == MotionEvent.TOOL_TYPE_STYLUS ||
      toolType == MotionEvent.TOOL_TYPE_ERASER

  /**
   * The same gesture with the button hidden, and every stylus pointer forced to [toolType] in both
   * directions, so a device that changes its own reading mid-stroke is overruled rather than
   * followed. TOOL_TYPE_UNKNOWN leaves the reported tool type alone, and a palm sharing the stream
   * stays a finger.
   *
   * Batched samples are carried over rather than dropped: the eraser tests a point per sample
   * without interpolating between them, so a stroke thinned to one sample a frame erases in dashes.
   */
  private fun rebuilt(event: MotionEvent, toolType: Int): MotionEvent {
    val count = event.pointerCount
    val properties = Array(count) { i ->
      MotionEvent.PointerProperties().also {
        event.getPointerProperties(i, it)
        if (toolType != MotionEvent.TOOL_TYPE_UNKNOWN && isStylusPointer(it.toolType)) {
          it.toolType = toolType
        }
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
