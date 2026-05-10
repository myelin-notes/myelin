/**
 * Visual chrome that wraps a canvas-embedded document (page-frame or PDF).
 * Draws a softer "paper backing" surface with a header strip containing a
 * hamburger menu and the document's display name.
 *
 * The chrome is positioned in screen space (to keep shadows and border-radii
 * at a constant pixel scale) while its inner header layout is rendered in
 * world units and CSS-scaled by the canvas zoom — so typography stays
 * consistent with the rest of the canvas as the user zooms.
 *
 * The foreground canvas sits above the chrome host layer, so the hamburger
 * button is rendered into a dedicated controls layer ("canvas-chrome-controls")
 * that lives above the canvas. Its position is synced every frame.
 */

import { Pencil as PencilIcon } from 'lucide-react';
import { type ChromeMenuItem, openChromeMenu } from '../chrome-menu';

export const CHROME_SIDE_PADDING = 20;
export const CHROME_BOTTOM_PADDING = 20;
export const CHROME_HEADER_HEIGHT = 56;
export const CHROME_CORNER_RADIUS = 16;

const MENU_BUTTON_SIZE = 32;
const MENU_BUTTON_TOP = (CHROME_HEADER_HEIGHT - MENU_BUTTON_SIZE) / 2;
const CONTROLS_LAYER_ID = 'canvas-chrome-controls';

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

  private readonly headerWrap: HTMLDivElement;
  private readonly headerInner: HTMLDivElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly titleInput: HTMLInputElement;
  private readonly kindEl: HTMLSpanElement;
  private fileName: string | null = null;
  private kindLabel: string;
  private isEditingTitle = false;
  private readonly onTitleCommit?: (title: string) => string | undefined;

  private readonly bgSurface: string;
  private readonly textPrimary: string;
  private readonly textSecondary: string;
  private readonly textMuted: string;
  private readonly bgHoverTint: string;

  constructor(options: FrameChromeOptions) {
    this.kindLabel = options.kindLabel;
    this.onTitleCommit = options.onTitleCommit;

    const resolve = (token: string, fallback: string) => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(token)
        .trim();
      return value || fallback;
    };
    this.bgSurface = resolve('--bg-surface', '#f2f4f6');
    this.textPrimary = resolve('--text-primary', '#191c1e');
    this.textSecondary = resolve('--text-secondary', '#43474a');
    this.textMuted = resolve('--text-muted', '#64748b');
    this.bgHoverTint = resolve('--bg-hover-tint', 'rgba(25, 28, 30, 0.05)');

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      background: this.bgSurface,
      borderRadius: `${CHROME_CORNER_RADIUS}px`,
      boxShadow:
        '0 1px 2px rgba(25, 28, 30, 0.03), 0 18px 44px rgba(25, 28, 30, 0.07)',
      pointerEvents: 'none',
      overflow: 'visible',
    } as Partial<CSSStyleDeclaration>);
    this.root.dataset.frameChrome = 'true';

    this.headerWrap = document.createElement('div');
    Object.assign(this.headerWrap.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      right: '0px',
      overflow: 'hidden',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.headerInner = document.createElement('div');
    Object.assign(this.headerInner.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      display: 'flex',
      alignItems: 'center',
      height: `${CHROME_HEADER_HEIGHT}px`,
      paddingLeft: `${CHROME_SIDE_PADDING}px`,
      paddingRight: `${CHROME_SIDE_PADDING}px`,
      gap: '14px',
      fontFamily: 'Inter, Arial, sans-serif',
      color: this.textPrimary,
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    const titleWrap = document.createElement('div');
    Object.assign(titleWrap.style, {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minWidth: '0',
      flex: '1 1 auto',
      gap: '2px',
    } as Partial<CSSStyleDeclaration>);

    this.kindEl = document.createElement('span');
    Object.assign(this.kindEl.style, {
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '10px',
      fontWeight: '600',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: this.textMuted,
      lineHeight: '1',
    } as Partial<CSSStyleDeclaration>);
    this.kindEl.textContent = this.kindLabel;

    this.titleEl = document.createElement('span');
    Object.assign(this.titleEl.style, {
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '14px',
      fontWeight: '500',
      color: this.textPrimary,
      lineHeight: '1.2',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      letterSpacing: '-0.005em',
    } as Partial<CSSStyleDeclaration>);
    this.titleEl.textContent = '';

    this.titleInput = document.createElement('input');
    this.titleInput.type = 'text';
    this.titleInput.setAttribute('aria-label', 'Page frame display name');
    this.titleInput.dataset.pageFramePreserveFocus = 'true';
    Object.assign(this.titleInput.style, {
      display: 'none',
      width: '100%',
      minWidth: '0',
      border: 'none',
      borderBottom: `2px solid ${this.textPrimary}`,
      borderRadius: '0',
      outline: 'none',
      padding: '0 0 2px',
      background: 'transparent',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '14px',
      fontWeight: '500',
      color: this.textPrimary,
      lineHeight: '1.2',
      letterSpacing: '-0.005em',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);

    titleWrap.appendChild(this.kindEl);
    titleWrap.appendChild(this.titleEl);
    titleWrap.appendChild(this.titleInput);

    // Reserve the button's footprint in the header layout so the title
    // truncates correctly. The actual interactive button lives in the
    // controls layer so it can sit above the foreground canvas.
    const menuSpacer = document.createElement('div');
    Object.assign(menuSpacer.style, {
      width: `${MENU_BUTTON_SIZE}px`,
      height: `${MENU_BUTTON_SIZE}px`,
      flex: '0 0 auto',
    } as Partial<CSSStyleDeclaration>);

    this.headerInner.appendChild(titleWrap);
    this.headerInner.appendChild(menuSpacer);
    this.headerWrap.appendChild(this.headerInner);

    this.contentSlot = document.createElement('div');
    Object.assign(this.contentSlot.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.root.appendChild(this.headerWrap);
    this.root.appendChild(this.contentSlot);

    this.menuButton = this.createMenuButton();
    const getItems = options.getMenuItems;
    if (getItems) {
      this.menuButton.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const items = this.getChromeMenuItems(getItems);
        if (items.length === 0) {
          return;
        }
        openChromeMenu(this.menuButton.getBoundingClientRect(), items);
      });
    }
    // The button lives in its own top-layer overlay so it's above the
    // foreground canvas. Append on construction; keep it hidden until the
    // first sync() call positions it.
    this.menuButton.style.visibility = 'hidden';
    getFrameChromeControlsLayer()?.appendChild(this.menuButton);
    this.initTitleInputEvents();

    this.refreshTitle();
  }

  public setFileName(name: string | null): void {
    if (name === this.fileName) {
      return;
    }
    this.fileName = name;
    this.refreshTitle();
  }

  public startTitleRename(): void {
    if (!this.onTitleCommit || this.isEditingTitle) {
      return;
    }
    this.isEditingTitle = true;
    this.titleInput.value = this.fileName ?? '';
    this.refreshTitle();
    requestAnimationFrame(() => {
      this.titleInput.focus();
      this.titleInput.select();
    });
  }

  public setKindLabel(label: string): void {
    if (label === this.kindLabel) {
      return;
    }
    this.kindLabel = label;
    this.kindEl.textContent = label;
  }

  private refreshTitle(): void {
    if (this.isEditingTitle) {
      this.titleEl.style.display = 'none';
      this.titleInput.style.display = '';
      return;
    }
    this.titleEl.textContent = this.fileName ?? '';
    this.titleEl.style.display = this.fileName ? '' : 'none';
    this.titleInput.style.display = 'none';
  }

  private getChromeMenuItems(
    getItems: () => ChromeMenuItem[],
  ): ChromeMenuItem[] {
    const items = getItems();
    if (!this.onTitleCommit) {
      return items;
    }
    return [
      {
        id: 'rename-frame',
        label: 'Rename',
        icon: PencilIcon,
        onSelect: () => this.startTitleRename(),
      },
      ...items,
    ];
  }

  private commitTitleRename(): void {
    if (!this.isEditingTitle) {
      return;
    }
    this.isEditingTitle = false;
    const committed = this.onTitleCommit?.(this.titleInput.value);
    if (typeof committed === 'string') {
      this.setFileName(committed);
    }
    this.refreshTitle();
  }

  private cancelTitleRename(): void {
    if (!this.isEditingTitle) {
      return;
    }
    this.isEditingTitle = false;
    this.titleInput.value = this.fileName ?? '';
    this.refreshTitle();
  }

  private initTitleInputEvents(): void {
    this.titleInput.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
    });
    this.titleInput.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });
    this.titleInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.commitTitleRename();
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.cancelTitleRename();
      }
    });
    this.titleInput.addEventListener('blur', () => {
      this.commitTitleRename();
    });
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

    this.headerWrap.style.height = `${CHROME_HEADER_HEIGHT * zoom}px`;
    this.headerInner.style.width = `${chromeWidth}px`;
    this.headerInner.style.transform = `scale(${zoom})`;

    this.contentSlot.style.transform = `translate(${CHROME_SIDE_PADDING * zoom}px, ${CHROME_HEADER_HEIGHT * zoom}px)`;
    this.contentSlot.style.width = `${contentWidth * zoom}px`;
    this.contentSlot.style.height = `${contentHeight * zoom}px`;

    // Sync the menu button (which lives in the overlay above the canvas).
    const buttonWorldRight = chromeWidth - CHROME_SIDE_PADDING;
    const buttonX = rootX + (buttonWorldRight - MENU_BUTTON_SIZE) * zoom;
    const buttonY = rootY + MENU_BUTTON_TOP * zoom;
    const buttonSize = MENU_BUTTON_SIZE * zoom;
    this.menuButton.style.visibility = 'visible';
    this.menuButton.style.transform = `translate(${buttonX}px, ${buttonY}px)`;
    this.menuButton.style.width = `${buttonSize}px`;
    this.menuButton.style.height = `${buttonSize}px`;
    this.menuButton.style.borderRadius = `${10 * zoom}px`;
  }

  public dispose(): void {
    this.root.remove();
    this.menuButton.remove();
  }

  private createMenuButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Menu';
    btn.setAttribute('aria-label', 'Open frame menu');
    Object.assign(btn.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      width: `${MENU_BUTTON_SIZE}px`,
      height: `${MENU_BUTTON_SIZE}px`,
      border: 'none',
      padding: '0',
      borderRadius: '10px',
      background: 'transparent',
      color: this.textSecondary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      transition: 'background 0.15s ease, color 0.15s ease',
    } as Partial<CSSStyleDeclaration>);

    btn.innerHTML = `
      <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="4" y1="7" x2="20" y2="7"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="17" x2="20" y2="17"/>
      </svg>
    `;

    btn.addEventListener('pointerdown', (ev) => {
      // prevent canvas from starting a pan/draw when user presses the button
      // and keep any active page-frame editor from losing DOM focus.
      ev.preventDefault();
      ev.stopPropagation();
    });
    btn.addEventListener('pointerenter', () => {
      btn.style.background = this.bgHoverTint;
      btn.style.color = this.textPrimary;
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = this.textSecondary;
    });

    return btn;
  }
}

export function getFrameChromeControlsLayer(): HTMLElement | null {
  return document.getElementById(CONTROLS_LAYER_ID);
}
