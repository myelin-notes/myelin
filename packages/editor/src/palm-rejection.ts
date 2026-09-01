// Covers only a hand settling into a *new* contact just after the tip leaves — one already resting
// never started anything. That lands within a few frames; every ms beyond is time the user cannot pan.
const GRACE_MS = 150;

/**
 * Whether a finger landing right now is the hand the stylus rests on.
 *
 * Consulted only at touch-down: an interaction belongs to the pointer that opened it, so a finger
 * turned away here can never reach a tool later, however long it stays on the glass. The OS already
 * drops most palm contact while a pen is in range; this covers what it lets through around a stroke.
 *
 * Driven entirely by stylus *contact*, never by hover: a pen held near the page while the other
 * hand pinches to zoom is an ordinary way to work. So a device that never sees a stylus is never
 * affected, and no "does this device have a pen" probing is needed.
 */
export class PalmRejection {
  private _penContact = false;
  private _penLiftedAt = 0;

  public get penContact(): boolean {
    return this._penContact;
  }

  public get suppressed(): boolean {
    return this._penContact || Date.now() - this._penLiftedAt < GRACE_MS;
  }

  public penDown(): void {
    this._penContact = true;
  }

  // Not keyed by pointer id: Android renumbers a stylus that changes tool type mid-gesture, and a
  // contact left open would reject every finger until the next stylus touch.
  public penUp(): void {
    if (!this._penContact) {
      return;
    }
    this._penContact = false;
    this._penLiftedAt = Date.now();
  }
}
