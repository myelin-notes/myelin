import { getCanvasPalette } from './canvas-theme';
import type { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { Vector2 } from './geometry';
import type { PlacementController } from './placement-controller';
import { BackgroundRenderer } from './rendering/background';
import { WebGLPainter } from './rendering/painter';
import type { SelectionController } from './selection-controller';
import type { ITool } from './tools/tool';
import { UserPrefs } from './user-prefs';

const CULL_MARGIN_PX = 128;

export function cullMarginWorld(zoom: number): number {
  return zoom > 0 && Number.isFinite(zoom)
    ? CULL_MARGIN_PX / zoom
    : Number.POSITIVE_INFINITY;
}

export class CanvasRenderer {
  readonly ctx: WebGLPainter;
  private background: BackgroundRenderer | null = null;
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = new WebGLPainter(canvas);
  }

  setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.background?.destroy();
    this.background = new BackgroundRenderer(canvas);
  }

  refreshSize(): void {
    this.ctx.resize(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      window.devicePixelRatio || 1,
    );
  }

  redraw(
    deltaTime: number,
    viewport: CanvasViewport,
    elements: DrawableElement[],
    editingElement: DrawableElement | null,
    toolSelected: ITool,
    screenPosition: Vector2,
    placementController: PlacementController,
    domOverlayHost: HTMLElement | null,
    selection: SelectionController,
  ): void {
    if (this.destroyed) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) {
      return;
    }
    const { zoom, offset } = viewport;
    this.background?.draw(
      width,
      height,
      dpr,
      zoom,
      offset.x,
      offset.y,
      UserPrefs.get('canvasBackground'),
      getCanvasPalette().grid,
    );

    const ctx = this.ctx;
    if (ctx.beginFrame(width, height, dpr)) {
      ctx.scale(zoom, zoom);
      ctx.translate(offset.x, offset.y);
      const viewRect = viewport.getWorldRect();
      const margin = cullMarginWorld(zoom);
      for (const element of elements) {
        if (element.intersectsWorldRect(viewRect, margin)) {
          element.draw(ctx, deltaTime);
        }
      }
      selection.advanceOverlay(deltaTime);
      selection.drawOverlay(ctx, editingElement, zoom);
      const mouseWorld = viewport.screenToWorld(screenPosition);
      if (placementController.isActive) {
        placementController.drawGhost(ctx, mouseWorld);
      } else {
        toolSelected.drawCursor(ctx, mouseWorld);
      }
      ctx.endFrame();
    }

    if (domOverlayHost) {
      for (const element of elements) {
        element.syncDOM(viewport, domOverlayHost);
      }
      // DOM roots share canvas order with page-frame chrome, so keep both z-index and sibling order
      // in sync. `syncDOM` only appends on create, so only out-of-position nodes move.
      reorderDomOverlay(domOverlayHost, elements);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.background?.destroy();
    this.ctx.destroy();
  }
}

export function reorderDomOverlay(
  host: HTMLElement,
  elements: readonly Pick<DrawableElement, 'uuid' | 'setDomZIndex'>[],
): void {
  const nodes = new Map<string, HTMLElement>();
  for (const child of host.children) {
    const node = child as HTMLElement;
    const uuid = node.dataset.elementUuid;
    if (uuid) {
      nodes.set(uuid, node);
    }
  }
  let prev: HTMLElement | null = null;
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const node = nodes.get(element.uuid);
    if (!node) {
      continue;
    }
    const zIndex = String(index + 1);
    if (node.style.zIndex !== zIndex) {
      node.style.zIndex = zIndex;
    }
    element.setDomZIndex(zIndex);
    const expected: Element | null = prev
      ? prev.nextElementSibling
      : host.firstElementChild;
    if (node !== expected) {
      host.insertBefore(node, expected);
    }
    prev = node;
  }
}
