/**
 * How long touch stays rejected after the stylus lifts. A palm leaves the glass
 * a moment after the pen does, and without a grace window that trailing contact
 * reads as a fresh gesture and pans the canvas out from under the last stroke.
 */
const GRACE_MS = 500;

/**
 * Decides which touches are a hand resting on the screen rather than input.
 *
 * Rejection is driven entirely by stylus *contact*, never by hover: a pen held
 * near the page while the other hand pinches to zoom is an ordinary way to
 * work, and suppressing touch for it would cost more than the stray palm it
 * would catch. So a device that never sees a stylus is never affected, and no
 * "does this device have a pen" probing is needed.
 */
export class PalmRejection {
  private penPointerId: number | null = null;
  private penLiftedAt: number = 0;
  private readonly palmIds = new Set<number>();

  /** Whether the stylus is recorded as being on the glass. */
  public get penContact(): boolean {
    return this.penPointerId !== null;
  }

  /** Whether touch gestures are currently rejected. */
  public get suppressed(): boolean {
    return (
      this.penPointerId !== null || Date.now() - this.penLiftedAt < GRACE_MS
    );
  }

  /**
   * Classify a touch that is going down. One that first appears while the
   * stylus is on the page is remembered, so it stays rejected for its whole
   * life — a hand that outlasts the grace window must not spring awake
   * underneath the pen.
   */
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

  /** Whether this pointer was already classified as a palm. */
  public isKnownPalm(pointerId: number): boolean {
    return this.palmIds.has(pointerId);
  }

  /**
   * The stylus touched down. Anything already on the screen is the hand it
   * rests on — the palm usually lands a moment before the tip — so those
   * touches are reclassified. The caller still has to unwind whatever gesture
   * they had started.
   */
  public penDown(pointerId: number, activeTouchIds: Iterable<number>): void {
    this.penPointerId = pointerId;
    for (const id of activeTouchIds) {
      this.palmIds.add(id);
    }
  }

  /**
   * Returns true when the lifted pointer was a rejected palm.
   *
   * Any stylus lifting ends the contact, even under an id that doesn't match
   * the one that landed. A platform is free to renumber a pointer mid-gesture
   * — Android does, when a stylus changes tool type part-way through — and
   * without this the pen would be recorded as still on the glass, leaving
   * every finger rejected with no way for the user to recover short of another
   * stylus contact.
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
