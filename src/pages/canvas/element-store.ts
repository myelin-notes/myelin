import type * as Y from 'yjs';
import type { DrawableElement } from './elements/drawable-element';

/**
 * Owns the canvas element collections and guarantees they mutate as a unit:
 * the uuid->element map, the z-ordered uuid list, the lazily-built ordered
 * snapshot, and the Y.Map->element map. Every mutation that affects ordering
 * invalidates the snapshot and fires the change callback, matching what the
 * canvas previously did inline.
 */
export class ElementStore {
  /** Element lookup keyed by stable uuid. */
  private _elements = new Map<string, DrawableElement>();
  /** Ordered list of element uuids in z-order (background first, foreground last). */
  private _elementOrder: string[] = [];
  /** Cached array snapshot for the public `elements` getter; null when stale. */
  private _orderedSnapshot: DrawableElement[] | null = null;
  /** Maps Y.Map instances to their DrawableElement wrappers. */
  private _yMapToElement = new Map<Y.Map<unknown>, DrawableElement>();

  /**
   * Called whenever the snapshot is invalidated. The canvas uses this to fire
   * its own change listeners at exactly the moments it did before; the store
   * never owns the listener fan-out itself.
   */
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

  public has(uuid: string): boolean {
    return this._elements.has(uuid);
  }

  public count(): number {
    return this._elements.size;
  }

  /** Iterate the raw element set (unordered). */
  public all(): IterableIterator<DrawableElement> {
    return this._elements.values();
  }

  /**
   * Atomic insert: add to the element map, splice the uuid into the order at
   * `position`, and register the Y.Map mapping. Invalidates the snapshot.
   */
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

  /**
   * Atomic remove by uuid: drop from the element map, filter the order list,
   * and remove the Y.Map mapping. Invalidates the snapshot.
   */
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

  /** Remove the element associated with `yMap`, if any. */
  public removeByYMap(yMap: Y.Map<unknown>): void {
    const element = this._yMapToElement.get(yMap);
    if (element) {
      this.remove(element.uuid);
    }
  }

  /**
   * Bulk remove by uuid set in one atomic step (single snapshot invalidation),
   * matching the Y.Array deletion phase. The Y.Map mappings for these uuids are
   * removed too.
   */
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

  /**
   * Lazily-built ordered snapshot. Rebuilt only when stale; walks the order
   * list and looks up each uuid, silently skipping any uuid not present in the
   * element map.
   */
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
