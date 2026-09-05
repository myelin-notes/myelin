import type { FileType, VFSNodeId } from '@/lib/sync';

export type TabId = string;
export type PaneId = string;
export type PanePage = 'graph' | 'settings';

export type TabTarget =
  | { type: 'graph' }
  | { type: 'settings' }
  | {
      type: 'canvas';
      id: VFSNodeId;
      pageFrameName?: string | null;
      pageFrameId?: string | null;
    }
  | { type: 'image'; id: VFSNodeId; fileType: FileType }
  | { type: 'csv'; id: VFSNodeId };

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
  activePage?: PanePage;
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
