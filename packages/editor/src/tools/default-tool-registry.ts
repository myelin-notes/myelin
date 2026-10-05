import type { MessageGetter } from '../i18n/messages';
import { EraserTool } from './eraser-tool';
import { HighlighterTool } from './highlighter-tool';
import { PenTool } from './pen-tool';
import { SelectTool } from './select-tool';
import { TextTool } from './text-tool';
import type { ITool } from './tool';

export function createDefaultTools(getStrings: MessageGetter): ITool[] {
  return [
    new SelectTool(getStrings),
    new PenTool(getStrings),
    new HighlighterTool(getStrings),
    new EraserTool(getStrings),
    new TextTool(getStrings),
  ];
}
