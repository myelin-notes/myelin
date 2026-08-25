import type * as Y from 'yjs';
import type { DrawableElement } from './elements/drawable-element';

/**
 * Owns the canvas element collections and guarantees they mutate as a unit. Every mutation that
 * affects ordering invalidates the snapshot and fires `onChange`.
 */
export class ElementStore {
  private _elements = new Map<string, DrawableElement>();
  /** Ordered list of element uuids in z-order (background first, foreground last). */
  private _elementOrder: string[] = [];
  /** Cached array snapshot for the public `elements` getter; null when stale. */
  private _orderedSnapshot: DrawableElement[] | null = null;
  private _yMapToElement = new Map<Y.Map<unknown>, DrawableElement>();

  private readonly onChange: () => void;

  public constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  public byUuid(uuid: string): DrawableElement | null {
    return this._elements.get(uuid) ?? null;
  }

  public byYMap(yMap: Y.Map<unknown>): DrawableElement | null {
    return this._yMapToElement.get(yMap) ?? null;
  }

  public count(): number {
    return this._elements.size;
  }

  /** Iterate the raw element set (unordered). */
  public all(): IterableIterator<DrawableElement> {
    return this._elements.values();
  }

  public add(
    element: DrawableElement,
    yMap: Y.Map<unknown>,
    position: number,
  ): void {
    this._elements.set(element.uuid, element);
    this._elementOrder.splice(position, 0, element.uuid);
    this._yMapToElement.set(yMap, element);
    this.invalidateSnapshot();
  }

  public remove(uuid: string): void {
    const element = this._elements.get(uuid);
    if (!element) {
      return;
    }
    this._elements.delete(uuid);
    this._elementOrder = this._elementOrder.filter((id) => id !== uuid);
    if (element.yMap) {
      this._yMapToElement.delete(element.yMap);
    }
    this.invalidateSnapshot();
  }

  public removeMany(uuids: ReadonlySet<string>): void {
    if (uuids.size === 0) {
      return;
    }
    for (const uuid of uuids) {
      const element = this._elements.get(uuid);
      if (element?.yMap) {
        this._yMapToElement.delete(element.yMap);
      }
      this._elements.delete(uuid);
    }
    this._elementOrder = this._elementOrder.filter((id) => !uuids.has(id));
    this.invalidateSnapshot();
  }

  /** Replace the z-order list entirely. Invalidates the snapshot. */
  public setOrder(uuids: string[]): void {
    this._elementOrder = uuids;
    this.invalidateSnapshot();
  }

  /** Current z-order list (background first, foreground last). */
  public order(): readonly string[] {
    return this._elementOrder;
  }

  // Rebuilt only when stale, silently skipping any uuid not present in the element map.
  public getOrdered(): DrawableElement[] {
    if (!this._orderedSnapshot) {
      const snapshot: DrawableElement[] = [];
      for (const uuid of this._elementOrder) {
        const element = this._elements.get(uuid);
        if (element) {
          snapshot.push(element);
        }
      }
      this._orderedSnapshot = snapshot;
    }
    return this._orderedSnapshot;
  }

  /** Clear all collections atomically. Invalidates the snapshot. */
  public clear(): void {
    this._elements.clear();
    this._elementOrder = [];
    this._yMapToElement.clear();
    this.invalidateSnapshot();
  }

  private invalidateSnapshot(): void {
    this._orderedSnapshot = null;
    this.onChange();
  }
}
