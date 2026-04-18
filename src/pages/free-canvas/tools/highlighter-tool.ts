import { Highlighter as HighlighterIcon } from 'lucide-react';
import type { DrawableCanvas } from '../drawable-canvas';
import { StrokeElement } from '../elements/stroke-element';
import { PenTool } from './pen-tool';
import type { CanvasStringsGetter, SvgIcon, ToolId, ToolOption } from './tool';

const HIGHLIGHT_COLORS = [
  '#facc15',
  '#4ade80',
  '#60a5fa',
  '#f472b6',
  '#fb923c',
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class HighlighterTool extends PenTool {
  constructor(getStrings: CanvasStringsGetter) {
    super(getStrings);
    this.color = '#facc15';
    this.size = 36;
  }

  get id(): ToolId {
    return 'highlighter';
  }

  public start(canvas: DrawableCanvas, _event: PointerEvent): void {
    this.currentStroke = canvas.addElement(
      (i) =>
        new StrokeElement(i, [], false, {
          color: hexToRgba(this.color, 0.3),
          size: this.size,
        }),
    );
  }

  get icon(): SvgIcon {
    return HighlighterIcon;
  }

  get label(): string {
    return this.getStrings().tools.highlighter;
  }

  getOptions(): ToolOption[] {
    const strings = this.getStrings();
    return [
      {
        type: 'color',
        key: 'color',
        label: strings.toolOptions.color,
        value: this.color,
        palette: HIGHLIGHT_COLORS,
      },
      {
        type: 'size',
        key: 'size',
        label: strings.toolOptions.stroke,
        value: this.size,
        min: 12,
        max: 60,
        step: 2,
      },
    ];
  }
}
