export const CHROME_SIDE_PADDING = 20;
export const CHROME_BOTTOM_PADDING = 20;
export const CHROME_HEADER_HEIGHT = 56;
export const CHROME_CORNER_RADIUS = 16;

export const MENU_BUTTON_SIZE = 32;
export const MENU_BUTTON_TOP = (CHROME_HEADER_HEIGHT - MENU_BUTTON_SIZE) / 2;
export const CANVAS_ROOT_SELECTOR = '[data-canvas-root]';
export const CONTROLS_LAYER_SELECTOR = '[data-canvas-chrome-controls]';

export interface FrameChromeMenuButtonRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  size: number;
}

export function getFrameChromeMenuButtonRect(params: {
  screenX: number;
  screenY: number;
  contentWidth: number;
  zoom: number;
}): FrameChromeMenuButtonRect {
  const { screenX, screenY, contentWidth, zoom } = params;
  const chromeWidth = contentWidth + CHROME_SIDE_PADDING * 2;
  const rootX = screenX - CHROME_SIDE_PADDING * zoom;
  const rootY = screenY - CHROME_HEADER_HEIGHT * zoom;
  const buttonWorldRight = chromeWidth - CHROME_SIDE_PADDING;
  const left = rootX + (buttonWorldRight - MENU_BUTTON_SIZE) * zoom;
  const top = rootY + MENU_BUTTON_TOP * zoom;
  const size = MENU_BUTTON_SIZE * zoom;
  return {
    left,
    top,
    right: left + size,
    bottom: top + size,
    size,
  };
}
