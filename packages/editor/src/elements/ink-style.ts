import { withCanvasAlpha } from '../canvas-theme';
import { parseCssColor } from '../pdf-export/color';
import type { DrawableElement } from './drawable-element';
import { ShapeElement } from './shape-element';
import { StrokeElement } from './stroke-element';

type InkElement = StrokeElement | ShapeElement;

export interface InkStyle {
  /** Opaque `#rrggbb`, the form palettes list colors in. */
  color: string;
  /** Rendered width in world units, which is what the pen's size option means. */
  thickness: number;
  /** Every stroke is translucent, so the highlighter's colors are the ones on offer. */
  highlighter: boolean;
}

export type InkStyleUpdate = Partial<Pick<InkStyle, 'color' | 'thickness'>>;

function editableInk(elements: readonly DrawableElement[]): InkElement[] {
  return elements.filter(
    (element): element is InkElement =>
      (element instanceof StrokeElement || element instanceof ShapeElement) &&
      !element.locked,
  );
}

// Resizing leaves `style.size` alone and scales it at render.
function renderedScale({ scale }: InkElement): number {
  return Math.max(Math.abs(scale.x), Math.abs(scale.y));
}

/** The first stroke's style stands in for a mixed selection. `null` when no ink is editable. */
export function readInkStyle(
  elements: readonly DrawableElement[],
): InkStyle | null {
  const ink = editableInk(elements);
  if (ink.length === 0) {
    return null;
  }
  const { color, size } = ink[0].strokeStyle;
  const channels = parseCssColor(color).rgb.map((channel) =>
    channel.toString(16).padStart(2, '0'),
  );
  return {
    color: `#${channels.join('')}`,
    thickness: Math.round(size * renderedScale(ink[0])),
    highlighter: ink.every(
      (element) => parseCssColor(element.strokeStyle.color).opacity < 1,
    ),
  };
}

/** Skips locked elements. A translucent stroke keeps its opacity, or a highlight would hide what's under it. */
export function applyInkStyle(
  elements: readonly DrawableElement[],
  { color, thickness }: InkStyleUpdate,
): void {
  for (const element of editableInk(elements)) {
    const { opacity } = parseCssColor(element.strokeStyle.color);
    element.setStrokeStyle({
      ...(color !== undefined && {
        color: opacity < 1 ? withCanvasAlpha(color, opacity) : color,
      }),
      ...(thickness !== undefined && {
        size: thickness / renderedScale(element),
      }),
    });
  }
}
