// Covers only a hand settling into a *new* contact just after the tip leaves — one already resting
// is a known palm. That lands within a few frames; every ms beyond is time the user cannot pan.
const GRACE_MS = 150;

/**
 * Rejection is driven entirely by stylus *contact*, never by hover: a pen held near the page while
 * the other hand pinches to zoom is an ordinary way to work. So a device that never sees a stylus
 * is never affected, and no "does this device have a pen" probing is needed.
 */
export class PalmRejection {
  private penPointerId: number | null = null;
  private penLiftedAt: number = 0;
  private readonly palmIds = new Set<number>();

  public get penContact(): boolean {
    return this.penPointerId !== null;
  }

  public get suppressed(): boolean {
    return (
      this.penPointerId !== null || Date.now() - this.penLiftedAt < GRACE_MS
    );
  }

  // A touch that first appears while the stylus is down stays rejected for its whole life — a hand
  // that outlasts the grace window must not spring awake under the pen. One appearing only within
  // the window is turned away without being remembered, so it goes live when the window closes.
  public isPalm(pointerId: number): boolean {
    if (this.palmIds.has(pointerId)) {
      return true;
    }
    if (this.penPointerId !== null) {
      this.palmIds.add(pointerId);
      return true;
    }
    return this.suppressed;
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

  /**
   * Returns true when the lifted pointer was a rejected palm.
   *
   * Any stylus lift ends the contact, even under an id that doesn't match the one that landed:
   * Android renumbers a pointer when a stylus changes tool type mid-gesture, and the pen would
   * otherwise stay recorded on the glass, rejecting every finger until the next stylus contact.
   */
  public pointerUp(pointerId: number, isPen: boolean = false): boolean {
    if (
      pointerId === this.penPointerId ||
      (isPen && this.penPointerId !== null)
    ) {
      this.penPointerId = null;
      this.penLiftedAt = Date.now();
    }
    return this.palmIds.delete(pointerId);
  }
}
