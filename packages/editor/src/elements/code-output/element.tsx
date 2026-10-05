import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type * as Y from 'yjs';
import { getCanvasPalette } from '../../canvas-theme';
import type { CanvasViewport } from '../../canvas-viewport';
import type { Vector2 } from '../../drawable-canvas';
import { codeRunStore } from '../../page-frame/pm/code-block/run-store';
import { PM_EDITOR_CLASS } from '../../page-frame/pm/constants';
import { mapPmRectToScreen } from '../../page-frame/pm/screen-rect';
import {
  DrawableElement,
  type ResizeHandle,
  ResizeHandles,
} from '../drawable-element';
import { ElementType } from '../element-type';
import { getFrameChromeControlsLayer } from '../frame/chrome';
import { CodeOutputCardView } from './card-view';

export const CODE_OUTPUT_DEFAULT_WIDTH = 360;
export const CODE_OUTPUT_DEFAULT_HEIGHT = 220;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 96;
/** World-px gap between the page frame's edge and an attached card. */
const ATTACH_GAP = 24;
/** Connector endpoints sit this far in from the corner nearest the run button / card header. */
const ANCHOR_INSET = 14;
/** Marching-dash speed while running, in screen px/s along the spline. */
const DASH_SPEED = 60;

interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Output card for a code block, linked by `(frameUuid, blockId)` and joined to it by a spline
 * connector drawn in `draw2D`. The run output itself is never persisted: the card renders the
 * live {@link codeRunStore} session for its block and is empty until the block is run again.
 * While `detached` is false the card's offset is re-derived from the block's on-screen rect every
 * frame (in-memory only — Yjs offset is written on drag), so it follows document edits and frame
 * moves; the first user drag detaches it for good.
 */
export class CodeOutputElement extends DrawableElement {
  private _frameUuid: string;
  private _blockId: string;
  private _detached = false;
  private _width = CODE_OUTPUT_DEFAULT_WIDTH;
  private _height = CODE_OUTPUT_DEFAULT_HEIGHT;

  private _root: HTMLDivElement | null = null;
  private _reactRoot: Root | null = null;

  private _anchorEditorDom: HTMLElement | null = null;
  private _anchorBlockDom: HTMLElement | null = null;
  /** Block rect in world coords, refreshed by syncDOM; null when the block is gone/unmounted. */
  private _anchorWorldRect: WorldRect | null = null;
  private _lastZoom = 1;
  private _dashPhase = 0;

  private _resizeBaseWidth = 0;
  private _resizeBaseHeight = 0;

  private _storeUnsubscribe: (() => void) | null = null;
  private _lastStoreVersion = -1;
  private _viewport: CanvasViewport | null = null;

  /** Stable across renders: the card registers it on a native listener keyed by identity. */
  private readonly _handleZoomWheel = (event: WheelEvent): void => {
    this._viewport?.handleWheel(event);
  };

  constructor(uuid: string, frameUuid = '', blockId = '') {
    super(uuid, ElementType.CODE_OUTPUT);
    this._frameUuid = frameUuid;
    this._blockId = blockId;
  }

  public get frameUuid(): string {
    return this._frameUuid;
  }
  public get blockId(): string {
    return this._blockId;
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      frameUuid: this._frameUuid,
      blockId: this._blockId,
      detached: this._detached,
      width: this._width,
      height: this._height,
    };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      frameUuid: (v) => {
        this._frameUuid = typeof v === 'string' ? v : '';
        this._anchorEditorDom = null;
        this._anchorBlockDom = null;
      },
      blockId: (v) => {
        this._blockId = typeof v === 'string' ? v : '';
        this._anchorBlockDom = null;
        this.render();
      },
      detached: (v) => {
        this._detached = v === true;
      },
      width: (v) => {
        this._width = typeof v === 'number' ? v : CODE_OUTPUT_DEFAULT_WIDTH;
        this.render();
      },
      height: (v) => {
        this._height = typeof v === 'number' ? v : CODE_OUTPUT_DEFAULT_HEIGHT;
        this.render();
      },
    });
  }

  // An attached card is pinned at its anchored top-left, so only grow-away handles are offered.
  public override get resizeHandles(): ResizeHandles {
    return this._detached
      ? ResizeHandles.All
      : ResizeHandles.Right | ResizeHandles.Bottom | ResizeHandles.BottomRight;
  }

  public override beginResize(): void {
    this._resizeBaseWidth = this._width;
    this._resizeBaseHeight = this._height;
  }

  // Resize adjusts width/height (text gains room, not size); scale stays 1.
  public override applyResize(opts: {
    handle: ResizeHandle;
    originalScale: Vector2;
    originalOffset: Vector2;
    ratioX: number;
    ratioY: number;
    anchorWorld: Vector2;
  }): void {
    const { handle: h, originalOffset, ratioX, ratioY, anchorWorld } = opts;
    if (h.scaleX) {
      this._width = Math.max(MIN_WIDTH, this._resizeBaseWidth * ratioX);
    }
    if (h.scaleY) {
      this._height = Math.max(MIN_HEIGHT, this._resizeBaseHeight * ratioY);
    }
    this.syncToYMap({ width: this._width, height: this._height });
    const newOffsetX = h.scaleX
      ? anchorWorld.x - h.anchorPad.x - this._width * h.anchorFx
      : originalOffset.x;
    const newOffsetY = h.scaleY
      ? anchorWorld.y - h.anchorPad.y - this._height * h.anchorFy
      : originalOffset.y;
    this.setOffset(newOffsetX, newOffsetY);
    this.render();
  }

  public override translate(dx: number, dy: number): void {
    super.translate(dx, dy);
    if (!this._detached && (dx !== 0 || dy !== 0)) {
      this._detached = true;
      this.syncToYMap({ detached: true });
    }
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(0, 0, this._width, this._height);
  }

  protected isOverLocal(x: number, y: number): boolean {
    return x >= 0 && x <= this._width && y >= 0 && y <= this._height;
  }

  protected updateBoundingBox(): void {}

  // DOM-backed card; the canvas pass only paints the connector spline to the source block.
  protected draw2D(ctx: CanvasRenderingContext2D, deltaTime: number): void {
    const anchor = this._anchorWorldRect;
    if (!anchor) {
      return;
    }

    const zoom = this._lastZoom || 1;
    const running = codeRunStore.getSession(this._blockId)?.running === true;

    // Endpoints in local space (offset already applied by draw(); scale is locked at 1).
    const ox = this.offset.x;
    const oy = this.offset.y;
    const cardCenterX = this._width / 2;
    const blockCenterX = (anchor.left + anchor.right) / 2 - ox;
    const blockCenterY = (anchor.top + anchor.bottom) / 2 - oy;
    const dxCenters = cardCenterX - blockCenterX;
    const dyCenters = this._height / 2 - blockCenterY;

    let p0: Vector2;
    let p3: Vector2;
    let axis: 'x' | 'y';
    if (Math.abs(dxCenters) >= Math.abs(dyCenters)) {
      axis = 'x';
      const fromRight = dxCenters >= 0;
      p0 = {
        x: (fromRight ? anchor.right : anchor.left) - ox,
        y: anchor.top - oy + ANCHOR_INSET,
      };
      p3 = {
        x: fromRight ? 0 : this._width,
        y: Math.min(ANCHOR_INSET, this._height / 2),
      };
    } else {
      axis = 'y';
      const fromBottom = dyCenters >= 0;
      p0 = {
        x: anchor.left - ox + ANCHOR_INSET,
        y: (fromBottom ? anchor.bottom : anchor.top) - oy,
      };
      p3 = {
        x: Math.min(ANCHOR_INSET, this._width / 2),
        y: fromBottom ? 0 : this._height,
      };
    }

    const reach =
      axis === 'x'
        ? Math.min(Math.max(Math.abs(p3.x - p0.x) * 0.5, 16), 120)
        : Math.min(Math.max(Math.abs(p3.y - p0.y) * 0.5, 16), 120);
    const dir0 = axis === 'x' ? Math.sign(p3.x - p0.x) || 1 : 0;
    const dir0y = axis === 'y' ? Math.sign(p3.y - p0.y) || 1 : 0;
    const c1 = { x: p0.x + dir0 * reach, y: p0.y + dir0y * reach };
    const c2 = { x: p3.x - dir0 * reach, y: p3.y - dir0y * reach };

    const palette = getCanvasPalette();
    ctx.save();
    ctx.strokeStyle =
      running || this.isSelected ? palette.selectionStroke : palette.border;
    ctx.lineWidth = 1.5 / zoom;
    ctx.lineCap = 'round';
    if (running) {
      // Dashes march toward the card while output streams — the run-state indicator.
      // Wraps on the 6+5px pattern period so the reset is seamless.
      this._dashPhase = (this._dashPhase + deltaTime * DASH_SPEED) % 11;
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      ctx.lineDashOffset = -this._dashPhase / zoom;
    }
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = ctx.strokeStyle;
    for (const p of [p0, p3]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  public override drawThumbnail(ctx: CanvasRenderingContext2D): void {
    const palette = getCanvasPalette();
    ctx.save();
    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.roundRect(0, 0, this._width, this._height, 10);
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, this._width, this._height, 10);
    ctx.stroke();

    // Header rule + a few abstract output lines.
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(this._width, 32);
    ctx.stroke();
    ctx.fillStyle = palette.border;
    const lineCount = Math.min(
      Math.max(codeRunStore.getSession(this._blockId)?.lines.length ?? 0, 1),
      Math.floor((this._height - 48) / 18),
    );
    for (let i = 0; i < lineCount; i++) {
      const w = this._width * (0.35 + ((i * 37) % 40) / 100);
      ctx.beginPath();
      ctx.roundRect(12, 44 + i * 18, Math.min(w, this._width - 24), 8, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    this._viewport = viewport;
    this._lastZoom = viewport.zoom;
    const derived = this.syncAnchor(viewport);
    if (!this._detached && derived) {
      this.setDerivedOffset(derived.x, derived.y);
    }

    const root = this._root ?? this.createRootElement(host);
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    const width = `${this._width}px`;
    if (root.style.width !== width) {
      root.style.width = width;
    }
    const height = `${this._height}px`;
    if (root.style.height !== height) {
      root.style.height = height;
    }
    // Layout at world px, GPU-scale to the zoom: the virtualizer's measured row
    // heights stay zoom-independent (transform doesn't affect offsetHeight).
    const transform = `scale(${viewport.zoom * this._scale.x}, ${viewport.zoom * this._scale.y})`;
    if (root.style.transform !== transform) {
      root.style.transform = transform;
    }
    // Mount after the geometry lands: React's first render must see a sized card, or the body's
    // flex height is unconstrained and the card view's initial scroll-to-bottom is a no-op.
    if (!this._reactRoot) {
      this.mountReact(root);
    }
  }

  public override disposeDOM(): void {
    this._storeUnsubscribe?.();
    this._storeUnsubscribe = null;
    this._reactRoot?.unmount();
    this._root?.remove();
    this._root = null;
    this._reactRoot = null;
  }

  /** Refresh the block's world rect; returns the derived attached offset, or null if unresolvable. */
  private syncAnchor(viewport: CanvasViewport): Vector2 | null {
    const editorDom = this.resolveEditorDom();
    const blockDom = this.resolveBlockDom(editorDom);
    // frame > viewport (zoom + scale) > content — same chain screen-rect.ts walks.
    const frameDiv = editorDom?.parentElement?.parentElement;
    if (!editorDom || !blockDom || !frameDiv) {
      this._anchorWorldRect = null;
      return null;
    }

    const frameClientRect = frameDiv.getBoundingClientRect();
    const screenRect = mapPmRectToScreen(
      frameClientRect,
      editorDom.getBoundingClientRect(),
      blockDom.getBoundingClientRect(),
    );
    const tl = viewport.getPoint({
      clientX: screenRect.left,
      clientY: screenRect.top,
    });
    const br = viewport.getPoint({
      clientX: screenRect.right,
      clientY: screenRect.bottom,
    });
    this._anchorWorldRect = {
      left: tl.x,
      top: tl.y,
      right: br.x,
      bottom: br.y,
    };

    const frameBr = viewport.getPoint({
      clientX: frameClientRect.right,
      clientY: frameClientRect.bottom,
    });
    if (editorDom.getAttribute('data-page-layout') === 'horizontal') {
      // Pages step sideways, so the empty canvas band is below the frame.
      return { x: tl.x, y: frameBr.y + ATTACH_GAP };
    }
    return { x: frameBr.x + ATTACH_GAP, y: tl.y };
  }

  // In-memory only: the derived position is recomputed every frame, so writing it to Yjs would
  // flood peers/saves. It is persisted on detach (via translate).
  private setDerivedOffset(x: number, y: number): void {
    this.offset.x = x;
    this.offset.y = y;
  }

  private resolveEditorDom(): HTMLElement | null {
    if (this._anchorEditorDom?.isConnected) {
      return this._anchorEditorDom;
    }
    this._anchorEditorDom = document.querySelector<HTMLElement>(
      `.${PM_EDITOR_CLASS}[data-frame-uuid="${this._frameUuid}"]`,
    );
    return this._anchorEditorDom;
  }

  private resolveBlockDom(editorDom: HTMLElement | null): HTMLElement | null {
    if (
      this._anchorBlockDom?.isConnected &&
      this._anchorBlockDom.dataset.blockId === this._blockId
    ) {
      return this._anchorBlockDom;
    }
    this._anchorBlockDom =
      editorDom?.querySelector<HTMLElement>(
        `.pm-code-block[data-block-id="${this._blockId}"]`,
      ) ?? null;
    return this._anchorBlockDom;
  }

  private createRootElement(host: HTMLElement): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'canvas-code-output';
    root.dataset.elementUuid = this.uuid;
    (getFrameChromeControlsLayer(host) ?? host).appendChild(root);
    this._root = root;
    return root;
  }

  private mountReact(root: HTMLDivElement): void {
    this._reactRoot = createRoot(root);
    // The card is a pure-props component; live run output reaches it by re-rendering here on
    // every store change for this block (see CodeOutputCardView for why not useSyncExternalStore).
    this._storeUnsubscribe = codeRunStore.subscribe(() => {
      const version = codeRunStore.getVersion(this._blockId);
      if (version !== this._lastStoreVersion) {
        this._lastStoreVersion = version;
        this.render();
      }
    });
    this.render();
  }

  /** No-op until the React root is mounted lazily in syncDOM. */
  private render(): void {
    if (!this._reactRoot) {
      return;
    }
    flushSync(() => {
      this._reactRoot!.render(
        <CodeOutputCardView
          session={codeRunStore.getSession(this._blockId)}
          onZoomWheel={this._handleZoomWheel}
        />,
      );
    });
  }
}
