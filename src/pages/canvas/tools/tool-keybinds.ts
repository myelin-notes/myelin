import { type Action, registry } from '@/lib/keybinds';
import type { ToolId } from './tool';

export const TOOL_ACTIONS: Record<ToolId, Action> = {
  select: 'canvas:tool-select',
  pen: 'canvas:tool-pen',
  highlighter: 'canvas:tool-highlighter',
  eraser: 'canvas:tool-eraser',
  text: 'canvas:tool-text',
};

export function getToolHotkey(toolId: ToolId): string {
  return registry.format(TOOL_ACTIONS[toolId]);
}

export type InsertActionId = 'frame' | 'embed';

export const INSERT_ACTIONS: Record<InsertActionId, Action> = {
  frame: 'canvas:insert-frame',
  embed: 'canvas:insert-embed',
};

export function getInsertHotkey(id: InsertActionId): string {
  return registry.format(INSERT_ACTIONS[id]);
}
