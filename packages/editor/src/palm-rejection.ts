// A palm leaves the glass a moment after the pen does; without a grace window that trailing
// contact reads as a fresh gesture and pans the canvas out from under the last stroke.
const GRACE_MS = 500;

/**
 * Rejection is driven entirely by stylus *contact*, never by hover: a pen held near the page while
 * the other hand pinches to zoom is an ordinary way to work. So a device that never sees a stylus
 * is never affected, and no "does this device have a pen" probing is needed.
 */
export class PalmRejection {
  private penPointerId: number | null = null;
  private penLiftedAt: number = 0;
  private readonly palmIds = new Set<number>();

  public get suppressed(): boolean {
    return (
      this.penPointerId !== null || Date.now() - this.penLiftedAt < GRACE_MS
    );
  }

  // A touch that first appears while the stylus is on the page stays rejected for its whole life —
  // a hand that outlasts the grace window must not spring awake underneath the pen.
  public isPalm(pointerId: number): boolean {
    if (this.palmIds.has(pointerId)) {
      return true;
    }
    if (this.suppressed) {
      this.palmIds.add(pointerId);
      return true;
    }
    return false;
  }

  public isKnownPalm(pointerId: number): boolean {
    return this.palmIds.has(pointerId);
  }

  // Anything already on the screen is the hand the stylus rests on — the palm usually lands a moment
  // before the tip — so those touches are reclassified. The caller must unwind their gesture.
  public penDown(pointerId: number, activeTouchIds: Iterable<number>): void {
    this.penPointerId = pointerId;
    for (const id of activeTouchIds) {
      this.palmIds.add(id);
    }
  }

  /** Returns true when the lifted pointer was a rejected palm. */
  public pointerUp(pointerId: number): boolean {
    if (pointerId === this.penPointerId) {
      this.penPointerId = null;
      this.penLiftedAt = Date.now();
    }
    return this.palmIds.delete(pointerId);
  }
}
