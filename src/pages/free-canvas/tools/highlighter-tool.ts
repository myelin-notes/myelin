import { Highlighter as HighlighterIcon } from 'lucide-react';
import type { DrawableCanvas } from '../drawable-canvas';
import { Stroke } from '../elements/stroke';
import { PenTool } from './pen-tool';
import type { SvgIcon, ToolOption } from './tool';

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
  constructor() {
    super();
    this.color = '#facc15';
    this.size = 36;
  }

  public start(canvas: DrawableCanvas, _event: PointerEvent): void {
    this.currentStroke = canvas.addElement(
      (i) =>
        new Stroke(i, [], false, {
          color: hexToRgba(this.color, 0.3),
          size: this.size,
        }),
    );
  }

  get icon(): SvgIcon {
    return HighlighterIcon;
  }

  get label(): string {
    return 'Highlighter';
  }

  getOptions(): ToolOption[] {
    return [
      {
        type: 'color',
        key: 'color',
        label: 'Color',
        value: this.color,
        palette: HIGHLIGHT_COLORS,
      },
      {
        type: 'size',
        key: 'size',
        label: 'Stroke',
        value: this.size,
        min: 12,
        max: 60,
        step: 2,
      },
    ];
  }
}
