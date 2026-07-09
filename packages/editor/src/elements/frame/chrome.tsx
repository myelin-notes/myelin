/**
 * Visual chrome that wraps a canvas-embedded document (page-frame or PDF).
 *
 * The React view owns the visible header/menu/title editing UI. This wrapper
 * keeps the canvas-facing imperative API for high-frequency geometry updates.
 */

import { createRef } from 'react';
import { Pencil as PencilIcon } from 'lucide-react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { type ChromeMenuItem, openChromeMenu } from '../../chrome-menu';
import { getMessages } from '../../i18n';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_CORNER_RADIUS,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
  CONTROLS_LAYER_ID,
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
  /**
   * Called when the hamburger button is clicked. Returning an empty array
   * suppresses the menu. Called lazily (per click) so items can reflect
   * current state.
   */
  getMenuItems?: () => ChromeMenuItem[];
  onTitleCommit?: (title: string) => string | undefined;
}

export class FrameChrome {
  public readonly root: HTMLDivElement;
  public readonly contentSlot: HTMLDivElement;

  private readonly controlsSlot: HTMLDivElement;
  private readonly reactRoot: Root;
  private readonly viewRef = createRef<FrameChromeViewHandle>();
  private readonly getMenuItems?: () => ChromeMenuItem[];
  private readonly onTitleCommit?: (title: string) => string | undefined;

  private fileName: string | null = null;
  private kindLabel: string;
  private disposed = false;

  constructor(options: FrameChromeOptions) {
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
    } as Partial<CSSStyleDeclaration>);

    getFrameChromeControlsLayer()?.appendChild(this.controlsSlot);
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

  /**
   * Position and size the chrome. `screenX`/`screenY` are the device-pixel
   * snapped screen coordinates of the underlying content's top-left. The
   * chrome is drawn extending above and around that point by padding + header.
   */
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

    this.root.style.transform = `translate(${rootX}px, ${rootY}px)`;
    this.root.style.width = `${chromeWidth * zoom}px`;
    this.root.style.height = `${chromeHeight * zoom}px`;
    this.root.style.borderRadius = `${CHROME_CORNER_RADIUS * zoom}px`;
    // Imperative writes on the header elements themselves — NOT custom
    // properties on this.root: the root is an ancestor of the whole editor
    // subtree, and inherited custom-property changes there forced a
    // full-subtree style recalc on every zoom frame.
    this.viewRef.current?.syncHeaderGeometry({
      headerHeight: CHROME_HEADER_HEIGHT * zoom,
      innerWidth: chromeWidth,
      zoom,
    });

    this.contentSlot.style.transform = `translate(${CHROME_SIDE_PADDING * zoom}px, ${CHROME_HEADER_HEIGHT * zoom}px)`;
    this.contentSlot.style.width = `${contentWidth * zoom}px`;
    this.contentSlot.style.height = `${contentHeight * zoom}px`;

    const buttonRect = getFrameChromeMenuButtonRect({
      screenX,
      screenY,
      contentWidth,
      zoom,
    });
    this.controlsSlot.style.visibility =
      params.controlsVisible === false ? 'hidden' : 'visible';
    this.controlsSlot.style.transform = `translate(${buttonRect.left}px, ${buttonRect.top}px)`;
    this.controlsSlot.style.width = `${buttonRect.size}px`;
    this.controlsSlot.style.height = `${buttonRect.size}px`;
    this.controlsSlot.style.borderRadius = `${10 * zoom}px`;
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

export function getFrameChromeControlsLayer(): HTMLElement | null {
  return document.getElementById(CONTROLS_LAYER_ID);
}
