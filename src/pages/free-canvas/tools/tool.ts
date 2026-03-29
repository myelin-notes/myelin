import type { LucideIcon } from 'lucide-react';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';

export type SvgIcon = LucideIcon;

export interface FontEntry {
  family: string;
  category: string;
}

export type ToolOption =
  | {
      type: 'color';
      key: string;
      label: string;
      value: string;
      palette: string[];
    }
  | {
      type: 'size';
      key: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      type: 'font';
      key: string;
      label: string;
      value: string;
      fonts: FontEntry[];
    }
  | {
      type: 'choice';
      key: string;
      label: string;
      value: string;
      choices: { value: string; label: string; icon?: LucideIcon }[];
    };

export interface ITool {
  start(canvas: DrawableCanvas, event: PointerEvent): void;
  update(canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void;
  finish(canvas: DrawableCanvas, event: PointerEvent): void;
  interrupt(canvas: DrawableCanvas): void;
  drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void;
  hover?(canvas: DrawableCanvas, position: Vector2): void;
  get icon(): SvgIcon;
  get label(): string;
  getOptions?(): ToolOption[];
  setOption?(key: string, value: unknown): void;
}
