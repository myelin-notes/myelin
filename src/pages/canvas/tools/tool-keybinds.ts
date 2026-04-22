import { type Action, registry } from '@/lib/keybinds';
import type { ToolId } from './tool';

export const TOOL_ACTIONS: Record<ToolId, Action> = {
  select: 'canvas:tool-select',
  pen: 'canvas:tool-pen',
  highlighter: 'canvas:tool-highlighter',
  eraser: 'canvas:tool-eraser',
  text: 'canvas:tool-text',
  embed: 'canvas:tool-embed',
  frame: 'canvas:tool-frame',
};

export function getToolHotkey(toolId: ToolId): string {
  return registry.format(TOOL_ACTIONS[toolId]);
}
