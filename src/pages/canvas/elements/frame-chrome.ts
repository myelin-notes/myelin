/**
 * Visual chrome that wraps a canvas-embedded document (page-frame or PDF).
 * Draws a softer "paper backing" surface with a header strip containing a
 * hamburger menu and the document's filename.
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

export const CHROME_SIDE_PADDING = 20;
export const CHROME_BOTTOM_PADDING = 20;
export const CHROME_HEADER_HEIGHT = 56;
export const CHROME_CORNER_RADIUS = 16;

const MENU_BUTTON_SIZE = 32;
const MENU_BUTTON_TOP = (CHROME_HEADER_HEIGHT - MENU_BUTTON_SIZE) / 2;
const CONTROLS_LAYER_ID = 'canvas-chrome-controls';

export interface FrameChromeOptions {
  kindLabel: string;
  onMenuClick?: (anchorRect: DOMRect, event: MouseEvent) => void;
}

export class FrameChrome {
  public readonly root: HTMLDivElement;
  public readonly contentSlot: HTMLDivElement;

  private readonly headerWrap: HTMLDivElement;
  private readonly headerInner: HTMLDivElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly kindEl: HTMLSpanElement;
  private fileName: string | null = null;
  private kindLabel: string;

  constructor(options: FrameChromeOptions) {
    this.kindLabel = options.kindLabel;

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      background: '#f2f4f6',
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
      color: '#191c1e',
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
      color: '#64748b',
      lineHeight: '1',
    } as Partial<CSSStyleDeclaration>);
    this.kindEl.textContent = this.kindLabel;

    this.titleEl = document.createElement('span');
    Object.assign(this.titleEl.style, {
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '14px',
      fontWeight: '500',
      color: '#191c1e',
      lineHeight: '1.2',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      letterSpacing: '-0.005em',
    } as Partial<CSSStyleDeclaration>);
    this.titleEl.textContent = '';

    titleWrap.appendChild(this.kindEl);
    titleWrap.appendChild(this.titleEl);

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
    if (options.onMenuClick) {
      const handler = options.onMenuClick;
      this.menuButton.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handler(this.menuButton.getBoundingClientRect(), ev);
      });
    }
    // The button lives in its own top-layer overlay so it's above the
    // foreground canvas. Append on construction; keep it hidden until the
    // first sync() call positions it.
    this.menuButton.style.visibility = 'hidden';
    getControlsLayer()?.appendChild(this.menuButton);

    this.refreshTitle();
  }

  public setFileName(name: string | null): void {
    if (name === this.fileName) {
      return;
    }
    this.fileName = name;
    this.refreshTitle();
  }

  public setKindLabel(label: string): void {
    if (label === this.kindLabel) {
      return;
    }
    this.kindLabel = label;
    this.kindEl.textContent = label;
  }

  private refreshTitle(): void {
    this.titleEl.textContent = this.fileName ?? '';
    this.titleEl.style.display = this.fileName ? '' : 'none';
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
      color: '#43474a',
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
      ev.stopPropagation();
    });
    btn.addEventListener('pointerenter', () => {
      btn.style.background = 'rgba(25, 28, 30, 0.08)';
      btn.style.color = '#191c1e';
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = '#43474a';
    });

    return btn;
  }
}

function getControlsLayer(): HTMLElement | null {
  return document.getElementById(CONTROLS_LAYER_ID);
}
