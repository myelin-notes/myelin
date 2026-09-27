// Covers only a hand settling into a *new* contact just after the tip leaves — one already resting
// is a known palm. That lands within a few frames; every ms beyond is time the user cannot pan.
const GRACE_MS = 150;
const PALM_CONTACT_MIN_PX = 64;

export function isBroadTouch(width: number, height: number): boolean {
  return Math.max(width, height) >= PALM_CONTACT_MIN_PX;
}

/** Rejects broad touch contacts and touches during or just after stylus contact. */
export class PalmRejection {
  private penPointerId: number | null = null;
  private penLiftedAt: number = 0;
  private readonly palmIds = new Set<number>();
  private readonly broadPalmIds = new Set<number>();

  public get penContact(): boolean {
    return this.penPointerId !== null;
  }

  public get suppressed(): boolean {
    return (
      this.penPointerId !== null ||
      this.broadPalmIds.size > 0 ||
      Date.now() - this.penLiftedAt < GRACE_MS
    );
  }

  // Broad contacts and touches that begin under the pen stay rejected until they lift. A touch
  // arriving only in the grace window becomes usable after the window closes.
  public isPalm(
    pointerId: number,
    width: number = 0,
    height: number = 0,
  ): boolean {
    if (isBroadTouch(width, height)) {
      this.palmIds.add(pointerId);
      this.broadPalmIds.add(pointerId);
      return true;
    }
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
    this.broadPalmIds.delete(pointerId);
    return this.palmIds.delete(pointerId);
  }
}
