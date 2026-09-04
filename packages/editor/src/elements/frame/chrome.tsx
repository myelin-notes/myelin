/**
 * Visual chrome around a canvas-embedded document (page frame or PDF). The React view owns the
 * visible header/menu/title UI; this wrapper keeps the canvas-facing imperative API for
 * high-frequency geometry updates.
 */

import { createRef } from 'react';
import { Pencil as PencilIcon } from 'lucide-react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { type ChromeMenuItem, openChromeMenu } from '../../chrome-menu';
import { getMessages } from '../../i18n';
import { quantizeRasterZoom } from '../../raster-zoom';
import { setStyleIfChanged } from '../../utils/style-cache';
import {
  CANVAS_ROOT_SELECTOR,
  CHROME_BOTTOM_PADDING,
  CHROME_CORNER_RADIUS,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
  CONTROLS_LAYER_SELECTOR,
  getFrameChromeMenuButtonRect,
} from './chrome-layout';
import { FrameChromeView, type FrameChromeViewHandle } from './chrome-view';

export {
  CHROME_BOTTOM_PADDING,
  CHROME_CORNER_RADIUS,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
} from './chrome-layout';

export interface FrameChromeOptions {
  kindLabel: string;
  // Returning an empty array suppresses the menu. Called lazily per click so items reflect
  // current state.
  getMenuItems?: () => ChromeMenuItem[];
  onTitleCommit?: (title: string) => string | undefined;
}

export class FrameChrome {
  public readonly root: HTMLDivElement;
  public readonly contentSlot: HTMLDivElement;
  public readonly controlsLayer: HTMLElement | null;

  private readonly controlsSlot: HTMLDivElement;
  private readonly reactRoot: Root;
  private readonly viewRef = createRef<FrameChromeViewHandle>();
  private readonly getMenuItems?: () => ChromeMenuItem[];
  private readonly onTitleCommit?: (title: string) => string | undefined;

  private fileName: string | null = null;
  private kindLabel: string;
  private disposed = false;

  constructor(options: FrameChromeOptions, host: HTMLElement) {
    this.kindLabel = options.kindLabel;
    this.getMenuItems = options.getMenuItems;
    this.onTitleCommit = options.onTitleCommit;

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      pointerEvents: 'none',
      overflow: 'visible',
      borderRadius: `${CHROME_CORNER_RADIUS}px`,
      willChange: 'transform',
    } as Partial<CSSStyleDeclaration>);
    this.root.dataset.frameChrome = 'true';

    this.contentSlot = document.createElement('div');
    Object.assign(this.contentSlot.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.controlsSlot = document.createElement('div');
    Object.assign(this.controlsSlot.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      pointerEvents: 'auto',
      visibility: 'hidden',
      willChange: 'transform',
    } as Partial<CSSStyleDeclaration>);

    this.controlsLayer = getFrameChromeControlsLayer(host);
    this.controlsLayer?.appendChild(this.controlsSlot);
    this.reactRoot = createRoot(this.root);
    this.render();
  }

  public setFileName(name: string | null): void {
    if (name === this.fileName) {
      return;
    }
    this.fileName = name;
    this.render();
  }

  public startTitleRename(): void {
    this.viewRef.current?.startTitleRename();
  }

  public setKindLabel(label: string): void {
    if (label === this.kindLabel) {
      return;
    }
    this.kindLabel = label;
    this.render();
  }

  // `screenX`/`screenY` are the device-pixel snapped screen coordinates of the underlying content's
  // top-left; the chrome extends above and around that point by padding + header.
  public sync(params: {
    screenX: number;
    screenY: number;
    contentWidth: number;
    contentHeight: number;
    zoom: number;
    controlsVisible?: boolean;
  }): void {
    const { screenX, screenY, contentWidth, contentHeight, zoom } = params;
    const chromeWidth = contentWidth + CHROME_SIDE_PADDING * 2;
    const chromeHeight =
      contentHeight + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING;

    const rootX = screenX - CHROME_SIDE_PADDING * zoom;
    const rootY = screenY - CHROME_HEADER_HEIGHT * zoom;

    // Sizing this subtree to the exact zoom repaints the whole promoted layer on every zoom frame
    // (4.5ms panning vs 14.63ms zooming on iPad), so it lays out at a quantized zoom and the root
    // carries the remainder as a scale. Positions stay on the exact zoom: a translate is free, and
    // they must stay pixel-accurate against the canvas beneath.
    const rasterZoom = quantizeRasterZoom(zoom);
    const residual = zoom / rasterZoom;

    setStyleIfChanged(
      this.root,
      'transform',
      `translate(${rootX}px, ${rootY}px) scale(${residual})`,
    );
    setStyleIfChanged(this.root, 'width', `${chromeWidth * rasterZoom}px`);
    setStyleIfChanged(this.root, 'height', `${chromeHeight * rasterZoom}px`);
    setStyleIfChanged(
      this.root,
      'border-radius',
      `${CHROME_CORNER_RADIUS * rasterZoom}px`,
    );
    // On the header elements themselves, NOT custom properties on this.root: the root is an ancestor
    // of the whole editor subtree, and inherited custom-property changes forced a full-subtree style
    // recalc on every zoom frame.
    this.viewRef.current?.syncHeaderGeometry({
      headerHeight: CHROME_HEADER_HEIGHT * rasterZoom,
      innerWidth: chromeWidth,
      zoom: rasterZoom,
    });

    setStyleIfChanged(
      this.contentSlot,
      'transform',
      `translate(${CHROME_SIDE_PADDING * rasterZoom}px, ${CHROME_HEADER_HEIGHT * rasterZoom}px)`,
    );
    setStyleIfChanged(
      this.contentSlot,
      'width',
      `${contentWidth * rasterZoom}px`,
    );
    setStyleIfChanged(
      this.contentSlot,
      'height',
      `${contentHeight * rasterZoom}px`,
    );

    const buttonRect = getFrameChromeMenuButtonRect({
      screenX,
      screenY,
      contentWidth,
      zoom,
    });
    setStyleIfChanged(
      this.controlsSlot,
      'visibility',
      params.controlsVisible === false ? 'hidden' : 'visible',
    );
    setStyleIfChanged(
      this.controlsSlot,
      'transform',
      `translate(${buttonRect.left}px, ${buttonRect.top}px)`,
    );
    setStyleIfChanged(this.controlsSlot, 'width', `${buttonRect.size}px`);
    setStyleIfChanged(this.controlsSlot, 'height', `${buttonRect.size}px`);
    setStyleIfChanged(this.controlsSlot, 'border-radius', `${10 * zoom}px`);
  }

  public dispose(): void {
    this.disposed = true;
    this.reactRoot.unmount();
    this.root.remove();
    this.controlsSlot.remove();
  }

  private render(): void {
    if (this.disposed) {
      return;
    }

    flushSync(() => {
      this.reactRoot.render(
        <FrameChromeView
          ref={this.viewRef}
          kindLabel={this.kindLabel}
          fileName={this.fileName}
          contentSlot={this.contentSlot}
          controlsSlot={this.controlsSlot}
          canRenameTitle={this.onTitleCommit !== undefined}
          onTitleCommit={this.commitTitle}
          onOpenMenu={this.openMenu}
        />,
      );
    });
  }

  private readonly commitTitle = (title: string): string | undefined => {
    const committed = this.onTitleCommit?.(title);
    if (typeof committed === 'string') {
      this.fileName = committed;
      this.render();
    }
    return committed;
  };

  private readonly openMenu = (anchor: DOMRect): void => {
    if (!this.getMenuItems) {
      return;
    }

    const items = this.getChromeMenuItems();
    if (items.length === 0) {
      return;
    }
    openChromeMenu(anchor, items);
  };

  private getChromeMenuItems(): ChromeMenuItem[] {
    const items = this.getMenuItems?.() ?? [];
    if (!this.onTitleCommit) {
      return items;
    }
    return [
      {
        id: 'rename-frame',
        label: getMessages().canvas.frame.rename,
        icon: PencilIcon,
        onSelect: () => this.startTitleRename(),
      },
      ...items,
    ];
  }
}

export function getFrameChromeControlsLayer(
  host: HTMLElement,
): HTMLElement | null {
  return (
    host
      .closest<HTMLElement>(CANVAS_ROOT_SELECTOR)
      ?.querySelector<HTMLElement>(CONTROLS_LAYER_SELECTOR) ?? null
  );
}
