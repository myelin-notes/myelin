import type { CanvasViewport } from './canvas-viewport';
import type { DrawableCanvas, Vector2 } from './drawable-canvas';
import type { DrawableElement } from './elements/drawable-element';
import { CollisionHelper } from './utils/collision-helper';

export interface EditSessionHost {
  drawableCanvas: DrawableCanvas;
  canvas: HTMLCanvasElement;
  viewport: CanvasViewport;
  getElements: () => readonly DrawableElement[];
  getActiveToolId: () => string;
  clearSelection: () => void;
  beginToolInteraction: (event: PointerEvent) => void;
  notifyChange: () => void;
}

export class EditSessionController {
  private editingElement: DrawableElement | null = null;
  private editDomRoot: HTMLElement | null = null;
  private cleanupListeners: (() => void) | null = null;
  private domOverlayHost: HTMLElement | null = null;
  private onElementEdit?: (element: DrawableElement | null) => void;

  public constructor(private readonly host: EditSessionHost) {}

  public get element(): DrawableElement | null {
    return this.editingElement;
  }

  public get isCanvasInteractive(): boolean {
    return this.editingElement !== null && this.editDomRoot === null;
  }

  public get domHost(): HTMLElement | null {
    return this.domOverlayHost;
  }

  public setDomOverlayHost(host: HTMLElement): void {
    this.domOverlayHost = host;
  }

  public setOnElementEdit(
    callback: (element: DrawableElement | null) => void,
  ): void {
    this.onElementEdit = callback;
  }

  public syncViewportEditModePan(): void {
    const element = this.editingElement;
    this.host.viewport.setEditMode(
      element !== null &&
        !this.isCanvasInteractive &&
        element.locksViewportPanWhileEditing,
      {
        panAxis:
          element !== null &&
          'pageLayout' in element &&
          element.pageLayout === 'horizontal'
            ? 'horizontal'
            : 'vertical',
      },
    );
  }

  public enter(element: DrawableElement, event?: Event): void {
    if (this.editingElement) {
      this.exit();
    }
    event?.stopPropagation();
    this.editingElement = element;
    this.host.notifyChange();
    if (this.domOverlayHost) {
      element.syncDOM(this.host.viewport, this.domOverlayHost);
    }
    const pointerEvent =
      typeof PointerEvent !== 'undefined' && event instanceof PointerEvent
        ? event
        : undefined;
    const editDomRoot = element.enterEditMode(
      this.host.drawableCanvas,
      pointerEvent?.clientX,
      pointerEvent?.clientY,
    );
    this.editDomRoot = editDomRoot;
    if (editDomRoot) {
      this.host.canvas.style.pointerEvents = 'none';
    }
    this.syncViewportEditModePan();
    this.onElementEdit?.(element);

    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        this.exit();
      }
    };
    const handlePointerDown = (pointerEvent: PointerEvent) => {
      if (
        editDomRoot &&
        !editDomRoot.contains(pointerEvent.target as Node) &&
        element.isSelected &&
        element.hitHandle(
          this.host.viewport.getPoint(pointerEvent),
          this.host.viewport.zoom,
          pointerEvent.pointerType === 'touch' &&
            this.host.getActiveToolId() === 'select',
        )
      ) {
        this.exit();
        this.host.beginToolInteraction(pointerEvent);
        return;
      }
      if (
        pointerEvent.target instanceof Element &&
        pointerEvent.target.closest('[data-selection-toolbar="true"]')
      ) {
        return;
      }
      if (!editDomRoot && pointerEvent.target === this.host.canvas) {
        return;
      }
      if (!editDomRoot?.contains(pointerEvent.target as Node)) {
        this.exit();
      }
    };
    const cursorHost = this.host.canvas.parentElement;
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (!editDomRoot || !cursorHost) {
        return;
      }
      const handle = element.isSelected
        ? element.hitHandle(
            this.host.viewport.getPoint(pointerEvent),
            this.host.viewport.zoom,
          )
        : null;
      cursorHost.style.cursor = handle ? handle.cursor : '';
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointermove', handlePointerMove);
    this.cleanupListeners = () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointermove', handlePointerMove);
      if (cursorHost) {
        cursorHost.style.cursor = '';
      }
    };
  }

  public exit(): void {
    if (!this.editingElement) {
      return;
    }
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.editingElement.exitEditMode();
    this.editingElement = null;
    this.editDomRoot = null;
    this.host.notifyChange();
    this.syncViewportEditModePan();
    this.host.canvas.style.pointerEvents = '';
    this.onElementEdit?.(null);
  }

  public enterAtPoint(point: Vector2, event?: Event): boolean {
    const elements = this.host.getElements();
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      if (
        !CollisionHelper.inBox(point, element.boundingBox) ||
        !element.editable
      ) {
        continue;
      }
      this.host.clearSelection();
      element.select();
      this.enter(element, event);
      return true;
    }
    return false;
  }

  public destroy(): void {
    this.exit();
  }
}
