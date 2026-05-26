import type { FileType, VFSNodeId } from '@/lib/sync';

export type TabId = string;
export type PaneId = string;

export type TabTarget =
  | { type: 'library' }
  | { type: 'settings' }
  | { type: 'canvas'; id: VFSNodeId; pageFrameName?: string | null }
  | { type: 'image'; id: VFSNodeId; fileType: FileType };

export interface Tab {
  id: TabId;
  target: TabTarget;
  title: string;
}

export interface PaneNode {
  type: 'pane';
  id: PaneId;
  tabs: Tab[];
  activeTabId: TabId;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface WindowState {
  layout: LayoutNode;
  focusedPaneId: PaneId;
}
