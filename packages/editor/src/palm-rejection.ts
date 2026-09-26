// Bridges brief gaps after pen hover or contact ends; a longer window delays intentional finger pan.
const GRACE_MS = 150;

/** Rejects touches while a stylus hovers, contacts the screen, or has just lifted. */
export class PalmRejection {
  private penPointerId: number | null = null;
  private penLiftedAt = -Infinity;
  private hoveringPen = false;
  private penHoverLeftAt = -Infinity;
  private readonly palmIds = new Set<number>();

  public get penContact(): boolean {
    return this.penPointerId !== null;
  }

  public get penHover(): boolean {
    return this.hoveringPen;
  }

  public get suppressed(): boolean {
    return (
      this.penPointerId !== null ||
      this.hoveringPen ||
      this.palmIds.size > 0 ||
      (this.penHoverLeftAt !== -Infinity &&
        Date.now() - this.penHoverLeftAt < GRACE_MS) ||
      (this.penLiftedAt !== -Infinity &&
        Date.now() - this.penLiftedAt < GRACE_MS)
    );
  }

  // Touches under pen hover, including its exit grace, stay rejected until lift. After contact,
  // a new touch becomes usable when the grace window closes.
  public isPalm(pointerId: number): boolean {
    if (this.palmIds.has(pointerId)) {
      return true;
    }
    if (
      this.penPointerId !== null ||
      this.hoveringPen ||
      (this.penHoverLeftAt !== -Infinity &&
        Date.now() - this.penHoverLeftAt < GRACE_MS)
    ) {
      this.palmIds.add(pointerId);
      return true;
    }
    return this.suppressed;
  }

  public isKnownPalm(pointerId: number): boolean {
    return this.palmIds.has(pointerId);
  }

  public penHoverStart(activeTouchIds: Iterable<number>): void {
    this.hoveringPen = true;
    for (const id of activeTouchIds) {
      this.palmIds.add(id);
    }
  }

  public penHoverEnd(): void {
    if (!this.hoveringPen) {
      return;
    }
    this.hoveringPen = false;
    this.penHoverLeftAt = Date.now();
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
