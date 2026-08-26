package com.github.wintersteve25.myelin

import android.view.InputDevice
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
 * Android hides it in a particular way. Chromium reads a stylus button as a
 * right-click: it swallows the entire pointer stream while the button is held
 * — no contact, no moves reach JS at all — and emits a lone `contextmenu` on
 * release. So the button can't be observed, and nothing can be drawn while it
 * is down. Handing the WebView the same gesture as an eraser-tipped stylus
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
   * The tool type every stylus pointer must report for the contact in
   * progress, or TOOL_TYPE_UNKNOWN between contacts.
   *
   * Chromium ties a pointer's identity to its tool type, so a tool type that
   * changes part-way through a gesture strands the pointer it started with: no
   * pointerup ever arrives for it, and a web layer that tracks pen contact —
   * palm rejection does — is left believing the pen never left the glass. So
   * the tool type is decided once, when the pen lands, and pinned until it
   * lifts: against the button changing underneath it, and against the device
   * changing its own reading, which some do while a button is held.
   *
   * A button pressed or released mid-stroke is therefore ignored, since
   * honouring it is precisely what strands the pointer.
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
    // A finger-only stream — which is how the touchscreen reports touches
    // while the pen digitizer reports its own — is left entirely alone, and
    // costs nothing beyond this check.
    if (!isFromStylus(event)) {
      return event
    }
    val hasButton = hasStylusButton(event)
    val action = event.actionMasked

    if (action == MotionEvent.ACTION_BUTTON_PRESS ||
        action == MotionEvent.ACTION_BUTTON_RELEASE) {
      // These carry no movement and exist only to announce the button — which
      // is the announcement Chromium turns into a right-click.
      return if (hasButton) null else event
    }

    if (isStylusDown(event, action)) {
      contactToolType =
        if (hasButton) MotionEvent.TOOL_TYPE_ERASER else stylusToolType(event)
    }
    // Between contacts nothing is pinned, so the button alone decides, and a
    // hovering pen with the button held previews as the eraser.
    val toolType = when {
      contactToolType != MotionEvent.TOOL_TYPE_UNKNOWN -> contactToolType
      hasButton -> MotionEvent.TOOL_TYPE_ERASER
      else -> MotionEvent.TOOL_TYPE_UNKNOWN
    }
    if (isStylusUp(event, action) || action == MotionEvent.ACTION_CANCEL) {
      contactToolType = MotionEvent.TOOL_TYPE_UNKNOWN
    }

    // A button pressed mid-stroke can no longer change the tool type, but it
    // still has to be hidden, or Chromium starts its right-click on the spot.
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
   * Which bit a barrel press lands on is not worth predicting: BUTTON_SECONDARY
   * and BUTTON_STYLUS_PRIMARY are both in use across vendors, and a device that
   * reports one may report the other in a later firmware. No stylus button
   * should do anything but erase, so they are all treated alike — except
   * BUTTON_PRIMARY, which some devices set for the tip itself, and which would
   * turn every ordinary stroke into an erase.
   *
   * The gate is the input source rather than the tool type, because the tool
   * type is one of the things a device may misreport while a button is held.
   *
   * BUTTON_TERTIARY is included, which means a second barrel button erases
   * here rather than opening the tool wheel as it does elsewhere. Narrowing
   * the mask would be better, but not before a device tells us which bit its
   * barrel actually uses.
   */
  private fun hasStylusButton(event: MotionEvent): Boolean {
    if (!isFromStylus(event)) {
      return false
    }
    // On release the button is already out of buttonState, so the event that
    // reports it names it in actionButton instead.
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
   * The same gesture with the button hidden, and every stylus pointer forced
   * to [toolType] — in both directions, so a device that changes its own
   * reading mid-stroke is overruled rather than followed. TOOL_TYPE_UNKNOWN
   * leaves the reported tool type alone.
   *
   * Only stylus pointers are touched — a palm sharing the stream stays a
   * finger. Batched samples are carried over rather than dropped: the eraser
   * tests a point per sample without interpolating between them, so a fast
   * stroke thinned to one sample a frame erases in dashes.
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
