import * as Y from 'yjs';
import {
  canMoveElementOrderForSelection,
  type ElementReorderDirection,
  moveElementOrderForSelection,
} from './element-ordering';
import { ElementStore } from './element-store';
import type { DrawableElement } from './elements/drawable-element';
import { isBackgroundElement } from './elements/element-type';
import { LOCAL_ORIGIN, type YDocManager } from './ydoc-manager';

const ELEMENT_Z_ORDER_KEY = 'zOrder';

type YElementsDeepObserver = Parameters<
  Y.Array<Y.Map<unknown>>['observeDeep']
>[0];
type YElementsDeepEvents = Parameters<YElementsDeepObserver>[0];
type YElementsDeepTransaction = Parameters<YElementsDeepObserver>[1];
type YElementsDeepEvent = YElementsDeepEvents[number];

export interface CanvasDocumentBindingOptions {
  ydoc: YDocManager;
  createElementFromYMap: (yMap: Y.Map<unknown>) => DrawableElement | null;
  initializeElement: (element: DrawableElement, yMap: Y.Map<unknown>) => void;
  onChange: () => void;
  onRemoteChange: () => void;
  onElementRemoved: (element: DrawableElement) => void;
}

export class CanvasDocumentBinding {
  private readonly ydoc: YDocManager;
  private readonly store: ElementStore;
  private readonly createElementFromYMap: CanvasDocumentBindingOptions['createElementFromYMap'];
  private readonly initializeElement: CanvasDocumentBindingOptions['initializeElement'];
  private readonly onRemoteChange: () => void;
  private readonly onElementRemoved: (element: DrawableElement) => void;
  private readonly yElementsObserver: YElementsDeepObserver = (
    events,
    transaction,
  ) => {
    this.handleYElementsChange(events, transaction);
  };

  public constructor(options: CanvasDocumentBindingOptions) {
    this.ydoc = options.ydoc;
    this.store = new ElementStore(options.onChange);
    this.createElementFromYMap = options.createElementFromYMap;
    this.initializeElement = options.initializeElement;
    this.onRemoteChange = options.onRemoteChange;
    this.onElementRemoved = options.onElementRemoved;
  }

  public get elements(): DrawableElement[] {
    return this.store.getOrdered();
  }

  public get ydocManager(): YDocManager {
    return this.ydoc;
  }

  public getElementByUuid(uuid: string): DrawableElement | null {
    return this.store.byUuid(uuid);
  }

  public hydrate(): void {
    for (let i = 0; i < this.ydoc.elements.length; i++) {
      const yMap = this.ydoc.elements.get(i);
      const element = this.createElementFromYMap(yMap);
      if (element) {
        this.store.add(element, yMap, this.store.count());
      }
    }
    this.rebuildElementOrderFromYDoc();
    this.ydoc.elements.observeDeep(this.yElementsObserver);
  }

  public destroy(): void {
    this.ydoc.elements.unobserveDeep(this.yElementsObserver);
    for (const element of this.store.all()) {
      this.onElementRemoved(element);
    }
    this.store.clear();
  }

  public transact(fn: () => void): void {
    this.ydoc.transact(fn);
  }

  public addElement<T extends DrawableElement>(
    factory: (uuid: string) => T,
    positionOverride: number | undefined,
  ): T {
    const uuid = crypto.randomUUID();
    const element = factory(uuid);
    const background = isBackgroundElement(element.type);
    const defaultPosition = background ? 0 : this.store.order().length;
    const requestedPosition = background
      ? defaultPosition
      : (positionOverride ?? defaultPosition);
    const position = Math.max(
      0,
      Math.min(requestedPosition, this.store.order().length),
    );
    const props: Record<string, unknown> = {
      offsetX: element.offset.x,
      offsetY: element.offset.y,
      scaleX: element.scale.x,
      scaleY: element.scale.y,
      [ELEMENT_Z_ORDER_KEY]: this.getZOrderForInsertion(position, background),
      ...element.getYMapProps(),
    };
    const yMap = background
      ? this.ydoc.insertElementMap(0, element.type, uuid, props)
      : this.ydoc.createElementMap(element.type, uuid, props);

    this.initializeElement(element, yMap);
    this.store.add(element, yMap, position);
    return element;
  }

  public insertElementMap(
    yMap: Y.Map<unknown>,
    options?: { background?: boolean; position?: number },
  ): DrawableElement | null {
    const background =
      options?.background ??
      isBackgroundElement(
        (yMap.get('type') as DrawableElement['type'] | undefined) ?? 0,
      );
    const position = Math.max(
      0,
      Math.min(
        options?.position ?? (background ? 0 : this.store.order().length),
        this.store.order().length,
      ),
    );
    yMap.set(
      ELEMENT_Z_ORDER_KEY,
      this.getZOrderForInsertion(position, background),
    );
    this.ydoc.insertExistingElementMap(position, yMap);
    const element = this.createElementFromYMap(yMap);
    if (!element) {
      this.ydoc.removeElementMap(yMap);
      return null;
    }
    this.store.add(element, yMap, position);
    return element;
  }

  public removeElement(element: DrawableElement): void {
    const yMap = element.yMap;
    if (yMap) {
      this.ydoc.removeElementMap(yMap);
    }
    this.store.remove(element.uuid);
    this.onElementRemoved(element);
  }

  public deleteElements(elements: readonly DrawableElement[]): void {
    if (elements.length === 0) {
      return;
    }
    this.ydoc.transact(() => {
      for (const element of elements) {
        element.unselect();
        if (element.yMap) {
          this.ydoc.removeElementMap(element.yMap);
        }
      }
    });
    for (const element of elements) {
      this.onElementRemoved(element);
    }
    this.store.removeMany(new Set(elements.map((element) => element.uuid)));
  }

  public canReorder(
    selectedUuids: Iterable<string>,
    direction: ElementReorderDirection,
  ): boolean {
    return canMoveElementOrderForSelection(
      this.getOrderItems(),
      selectedUuids,
      direction,
    );
  }

  public reorder(
    selectedUuids: Iterable<string>,
    direction: ElementReorderDirection,
  ): boolean {
    const selected = [...selectedUuids];
    if (!this.canReorder(selected, direction)) {
      return false;
    }
    const nextOrder = moveElementOrderForSelection(
      this.getOrderItems(),
      selected,
      direction,
    );
    this.ydoc.undoManager.stopCapturing();
    this.ydoc.transact(() => {
      this.store.setOrder(nextOrder);
      this.persistCurrentElementOrder();
    });
    this.ydoc.undoManager.stopCapturing();
    return true;
  }

  private getOrderItems() {
    return this.elements.map((element) => ({
      uuid: element.uuid,
      type: element.type,
    }));
  }

  private getElementZOrderValue(
    element: DrawableElement,
    fallback: number,
  ): number {
    const value = element.yMap?.get(ELEMENT_Z_ORDER_KEY);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private rebuildElementOrderFromYDoc(): void {
    const ordered: Array<{
      element: DrawableElement;
      arrayIndex: number;
      zOrder: number;
    }> = [];
    for (let i = 0; i < this.ydoc.elements.length; i++) {
      const yMap = this.ydoc.elements.get(i);
      const element = this.store.byYMap(yMap);
      if (!element) {
        continue;
      }
      ordered.push({
        element,
        arrayIndex: i,
        zOrder: this.getElementZOrderValue(element, i),
      });
    }
    ordered.sort((a, b) => {
      const layerDelta =
        Number(!isBackgroundElement(a.element.type)) -
        Number(!isBackgroundElement(b.element.type));
      if (layerDelta !== 0) {
        return layerDelta;
      }
      const orderDelta = a.zOrder - b.zOrder;
      return orderDelta !== 0 ? orderDelta : a.arrayIndex - b.arrayIndex;
    });
    this.store.setOrder(ordered.map(({ element }) => element.uuid));
  }

  private getZOrderForInsertion(position: number, background: boolean): number {
    const order = this.store.order();
    let before: DrawableElement | null = null;
    let after: DrawableElement | null = null;
    for (let i = position - 1; i >= 0; i--) {
      const element = this.store.byUuid(order[i]);
      if (element && isBackgroundElement(element.type) === background) {
        before = element;
        break;
      }
    }
    for (let i = position; i < order.length; i++) {
      const element = this.store.byUuid(order[i]);
      if (element && isBackgroundElement(element.type) === background) {
        after = element;
        break;
      }
    }
    const beforeZ = before
      ? this.getElementZOrderValue(before, position - 1)
      : undefined;
    const afterZ = after
      ? this.getElementZOrderValue(after, position)
      : undefined;
    if (beforeZ !== undefined && afterZ !== undefined) {
      return (beforeZ + afterZ) / 2;
    }
    return beforeZ !== undefined ? beforeZ + 1 : (afterZ ?? 0) - 1;
  }

  private persistCurrentElementOrder(): void {
    this.elements.forEach((element, index) => {
      element.yMap?.set(ELEMENT_Z_ORDER_KEY, index);
    });
  }

  private handleYElementsChange(
    events: YElementsDeepEvents,
    transaction: YElementsDeepTransaction,
  ): void {
    if (transaction.origin === LOCAL_ORIGIN) {
      return;
    }
    this.onRemoteChange();
    let changedElementOrder = false;
    const insertedMaps = new Set<Y.Map<unknown>>();
    for (const event of events) {
      if (
        event instanceof Y.YArrayEvent &&
        event.target === this.ydoc.elements
      ) {
        this.collectInsertedMaps(event, insertedMaps);
        this.handleYArrayChange(event as Y.YArrayEvent<Y.Map<unknown>>);
      }
    }
    for (const event of events) {
      if (event instanceof Y.YMapEvent) {
        const yMap = event.target as Y.Map<unknown>;
        if (insertedMaps.has(yMap)) {
          continue;
        }
        if (event.keysChanged.has(ELEMENT_Z_ORDER_KEY)) {
          changedElementOrder = true;
        }
        this.syncElementFromYMapEvent(yMap, event.keysChanged);
      } else if (
        event instanceof Y.YArrayEvent &&
        event.target !== this.ydoc.elements
      ) {
        this.syncElementFromNestedEvent(event);
      }
    }
    if (changedElementOrder) {
      this.rebuildElementOrderFromYDoc();
    }
  }

  private collectInsertedMaps(
    event: Y.YArrayEvent<Y.Map<unknown>>,
    insertedMaps: Set<Y.Map<unknown>>,
  ): void {
    for (const delta of event.changes.delta) {
      if (!('insert' in delta) || !Array.isArray(delta.insert)) {
        continue;
      }
      for (const value of delta.insert) {
        if (value instanceof Y.Map) {
          insertedMaps.add(value as Y.Map<unknown>);
        }
      }
    }
  }

  private syncElementFromYMapEvent(
    yMap: Y.Map<unknown>,
    keysChanged: Set<unknown>,
  ): void {
    const element = this.store.byYMap(yMap);
    if (!element) {
      return;
    }
    const keys = Array.from(keysChanged).filter(
      (key): key is string => typeof key === 'string',
    );
    element.syncFromYMap(keys);
  }

  private syncElementFromNestedEvent(event: YElementsDeepEvent): void {
    const [elementPosition, fieldKey] = event.path;
    if (typeof elementPosition !== 'number' || typeof fieldKey !== 'string') {
      return;
    }
    const yMap = this.ydoc.elements.get(elementPosition);
    this.store.byYMap(yMap)?.syncFromYMap([fieldKey]);
  }

  private handleYArrayChange(event: Y.YArrayEvent<Y.Map<unknown>>): void {
    let position = 0;
    for (const delta of event.changes.delta) {
      if ('retain' in delta) {
        position += delta.retain ?? 0;
      }
      if ('insert' in delta) {
        for (const yMap of delta.insert as Y.Map<unknown>[]) {
          if (!this.store.byYMap(yMap)) {
            const element = this.createElementFromYMap(yMap);
            if (element) {
              this.store.add(element, yMap, position);
            }
          }
          position++;
        }
      }
    }

    const currentYMaps = new Set<Y.Map<unknown>>();
    for (let i = 0; i < this.ydoc.elements.length; i++) {
      currentYMaps.add(this.ydoc.elements.get(i));
    }
    const removed = new Set<string>();
    for (const element of this.store.all()) {
      if (element.yMap && !currentYMaps.has(element.yMap)) {
        this.onElementRemoved(element);
        removed.add(element.uuid);
      }
    }
    this.store.removeMany(removed);
    this.rebuildElementOrderFromYDoc();
  }
}
