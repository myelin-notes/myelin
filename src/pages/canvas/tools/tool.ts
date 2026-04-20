import type { LucideIcon } from 'lucide-react';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';

export type SvgIcon = LucideIcon;
export type ToolId =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'embed';

export interface FontEntry {
  family: string;
  category: string;
}

type ToolOptionBase<TType extends string, TValue> = {
  type: TType;
  key: string;
  label: string;
  value: TValue;
  set: (value: TValue) => void;
};

export type ToolOption =
  | (ToolOptionBase<'color', string> & {
      palette: string[];
    })
  | (ToolOptionBase<'size', number> & {
      min: number;
      max: number;
      step: number;
    })
  | (ToolOptionBase<'font', string> & {
      fonts: FontEntry[];
    })
  | (ToolOptionBase<'choice', string> & {
      choices: { value: string; label: string; icon?: LucideIcon }[];
    });

export interface ITool {
  get id(): ToolId;
  start(canvas: DrawableCanvas, event: PointerEvent): void;
  update(canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void;
  finish(canvas: DrawableCanvas, event: PointerEvent): void;
  interrupt(canvas: DrawableCanvas): void;
  drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void;
  hover?(canvas: DrawableCanvas, position: Vector2): void;
  get icon(): SvgIcon;
  get label(): string;
  getOptions?(): ToolOption[];
  /** Push an option change onto the tool's currently-selected elements. */
  applyOptionToSelection?(
    canvas: DrawableCanvas,
    key: string,
    value: unknown,
  ): void;
}

export function setToolOptionValue(
  option: ToolOption,
  value: unknown,
): boolean {
  switch (option.type) {
    case 'color':
    case 'font':
    case 'choice':
      if (typeof value !== 'string') {
        return false;
      }
      option.set(value);
      return true;
    case 'size':
      if (typeof value !== 'number') {
        return false;
      }
      option.set(value);
      return true;
  }
}

export function setToolOption(
  tool: ITool,
  key: string,
  value: unknown,
): boolean {
  const option = tool.getOptions?.().find((candidate) => candidate.key === key);
  if (!option) {
    return false;
  }
  return setToolOptionValue(option, value);
}
