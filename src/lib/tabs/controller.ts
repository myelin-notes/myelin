import type {
  LayoutNode,
  PaneId,
  PaneNode,
  SplitDirection,
  SplitNode,
  Tab,
  TabId,
  TabTarget,
  WindowState,
} from './types';

function createPaneId(): PaneId {
  return crypto.randomUUID();
}

function createTabId(): TabId {
  return crypto.randomUUID();
}

function createSplitId(): string {
  return crypto.randomUUID();
}

function targetsEqual(a: TabTarget, b: TabTarget): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'library':
    case 'settings':
      return true;
    case 'canvas':
      return a.id === (b as Extract<TabTarget, { type: 'canvas' }>).id;
    case 'image':
      return a.id === (b as Extract<TabTarget, { type: 'image' }>).id;
  }
}

function findPane(
  node: LayoutNode,
  paneId: PaneId,
): PaneNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}

function findPaneForTab(
  node: LayoutNode,
  tabId: TabId,
): PaneNode | null {
  if (node.type === 'pane') {
    return node.tabs.some((t) => t.id === tabId) ? node : null;
  }
  for (const child of node.children) {
    const found = findPaneForTab(child, tabId);
    if (found) return found;
  }
  return null;
}

function findFirstPane(node: LayoutNode): PaneNode {
  if (node.type === 'pane') return node;
  return findFirstPane(node.children[0]);
}

function collectPaneIds(node: LayoutNode): PaneId[] {
  if (node.type === 'pane') return [node.id];
  return node.children.flatMap(collectPaneIds);
}

function replaceNode(
  root: LayoutNode,
  targetId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (root.type === 'pane') {
    return root.id === targetId ? replacement : root;
  }
  if (root.id === targetId) return replacement;
  return {
    ...root,
    children: root.children.map((child) =>
      replaceNode(child, targetId, replacement),
    ),
  };
}

function removePane(root: LayoutNode, paneId: PaneId): LayoutNode | null {
  if (root.type === 'pane') {
    return root.id === paneId ? null : root;
  }

  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];
  let removedSize = 0;

  for (let i = 0; i < root.children.length; i++) {
    const result = removePane(root.children[i], paneId);
    if (result) {
      newChildren.push(result);
      newSizes.push(root.sizes[i]);
    } else {
      removedSize += root.sizes[i];
    }
  }

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  const sizeScale = 100 / (100 - removedSize);
  return {
    ...root,
    children: newChildren,
    sizes: newSizes.map((s) => s * sizeScale),
  };
}

export function createDefaultWindowState(): WindowState {
  const paneId = createPaneId();
  const tabId = createTabId();
  return {
    layout: {
      type: 'pane',
      id: paneId,
      tabs: [{ id: tabId, target: { type: 'library' }, title: 'Library' }],
      activeTabId: tabId,
    },
    focusedPaneId: paneId,
  };
}

export function createWindowStateWithTab(tab: Tab): WindowState {
  const paneId = createPaneId();
  return {
    layout: {
      type: 'pane',
      id: paneId,
      tabs: [tab],
      activeTabId: tab.id,
    },
    focusedPaneId: paneId,
  };
}

export class TabStateController {
  private state: WindowState;
  private readonly listeners = new Set<() => void>();

  constructor(initialState?: WindowState) {
    this.state = initialState ?? createDefaultWindowState();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WindowState => this.state;

  replaceState(state: WindowState): void {
    this.state = state;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private update(next: WindowState): void {
    this.state = next;
    this.emit();
  }

  openTab(target: TabTarget, title: string, paneId?: PaneId): TabId {
    const state = this.state;
    const targetPaneId = paneId ?? state.focusedPaneId;
    const pane = findPane(state.layout, targetPaneId);
    if (!pane) return this.openTabInFirstPane(target, title);

    const existing = pane.tabs.find((t) => targetsEqual(t.target, target));
    if (existing) {
      this.activateTab(existing.id, targetPaneId);
      return existing.id;
    }

    const tabId = createTabId();
    const newTab: Tab = { id: tabId, target, title };
    const activeIndex = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
    const insertIndex = activeIndex + 1;
    const newTabs = [
      ...pane.tabs.slice(0, insertIndex),
      newTab,
      ...pane.tabs.slice(insertIndex),
    ];

    this.update({
      ...state,
      layout: replaceNode(state.layout, pane.id, {
        ...pane,
        tabs: newTabs,
        activeTabId: tabId,
      }),
      focusedPaneId: targetPaneId,
    });
    return tabId;
  }

  private openTabInFirstPane(target: TabTarget, title: string): TabId {
    const pane = findFirstPane(this.state.layout);
    return this.openTab(target, title, pane.id);
  }

  closeTab(tabId: TabId, paneId: PaneId): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) return;

    const tabIndex = pane.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const newTabs = pane.tabs.filter((t) => t.id !== tabId);

    if (newTabs.length === 0) {
      this.closePane(paneId);
      return;
    }

    let newActiveTabId = pane.activeTabId;
    if (pane.activeTabId === tabId) {
      const nextIndex = Math.min(tabIndex, newTabs.length - 1);
      newActiveTabId = newTabs[nextIndex].id;
    }

    this.update({
      ...state,
      layout: replaceNode(state.layout, pane.id, {
        ...pane,
        tabs: newTabs,
        activeTabId: newActiveTabId,
      }),
    });
  }

  activateTab(tabId: TabId, paneId: PaneId): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) return;
    if (pane.activeTabId === tabId) {
      if (state.focusedPaneId !== paneId) {
        this.update({ ...state, focusedPaneId: paneId });
      }
      return;
    }

    this.update({
      ...state,
      layout: replaceNode(state.layout, pane.id, {
        ...pane,
        activeTabId: tabId,
      }),
      focusedPaneId: paneId,
    });
  }

  moveTab(
    tabId: TabId,
    fromPaneId: PaneId,
    toPaneId: PaneId,
    index: number,
  ): void {
    if (fromPaneId === toPaneId) {
      this.reorderTab(tabId, fromPaneId, index);
      return;
    }

    const state = this.state;
    const fromPane = findPane(state.layout, fromPaneId);
    const toPane = findPane(state.layout, toPaneId);
    if (!fromPane || !toPane) return;

    const tab = fromPane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const fromTabs = fromPane.tabs.filter((t) => t.id !== tabId);
    const toTabs = [
      ...toPane.tabs.slice(0, index),
      tab,
      ...toPane.tabs.slice(index),
    ];

    let layout = state.layout;

    if (fromTabs.length === 0) {
      const removed = removePane(layout, fromPaneId);
      if (!removed) return;
      layout = removed;
    } else {
      let newActiveTabId = fromPane.activeTabId;
      if (fromPane.activeTabId === tabId) {
        const tabIndex = fromPane.tabs.findIndex((t) => t.id === tabId);
        const nextIndex = Math.min(tabIndex, fromTabs.length - 1);
        newActiveTabId = fromTabs[nextIndex].id;
      }
      layout = replaceNode(layout, fromPane.id, {
        ...fromPane,
        tabs: fromTabs,
        activeTabId: newActiveTabId,
      });
    }

    layout = replaceNode(layout, toPane.id, {
      ...toPane,
      tabs: toTabs,
      activeTabId: tabId,
    });

    const paneIds = collectPaneIds(layout);
    const focusedPaneId = paneIds.includes(toPaneId)
      ? toPaneId
      : paneIds[0];

    this.update({ layout, focusedPaneId });
  }

  private reorderTab(tabId: TabId, paneId: PaneId, newIndex: number): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) return;

    const oldIndex = pane.tabs.findIndex((t) => t.id === tabId);
    if (oldIndex === -1 || oldIndex === newIndex) return;

    const newTabs = [...pane.tabs];
    const [moved] = newTabs.splice(oldIndex, 1);
    newTabs.splice(newIndex, 0, moved);

    this.update({
      ...state,
      layout: replaceNode(state.layout, pane.id, {
        ...pane,
        tabs: newTabs,
      }),
    });
  }

  splitPane(paneId: PaneId, direction: SplitDirection): PaneId {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) return paneId;

    const newPaneId = createPaneId();
    const newTabId = createTabId();
    const newPane: PaneNode = {
      type: 'pane',
      id: newPaneId,
      tabs: [{ id: newTabId, target: { type: 'library' }, title: 'Library' }],
      activeTabId: newTabId,
    };

    const split: SplitNode = {
      type: 'split',
      id: createSplitId(),
      direction,
      children: [pane, newPane],
      sizes: [50, 50],
    };

    this.update({
      ...state,
      layout: replaceNode(state.layout, pane.id, split),
    });

    return newPaneId;
  }

  splitPaneWithTab(
    paneId: PaneId,
    direction: SplitDirection,
    tabId: TabId,
  ): PaneId {
    const state = this.state;
    const fromPane = findPaneForTab(state.layout, tabId);
    if (!fromPane) return paneId;

    const tab = fromPane.tabs.find((t) => t.id === tabId);
    if (!tab) return paneId;

    const newPaneId = createPaneId();
    const newPane: PaneNode = {
      type: 'pane',
      id: newPaneId,
      tabs: [tab],
      activeTabId: tab.id,
    };

    const fromTabs = fromPane.tabs.filter((t) => t.id !== tabId);
    let layout = state.layout;

    if (fromTabs.length > 0) {
      let newActiveTabId = fromPane.activeTabId;
      if (fromPane.activeTabId === tabId) {
        const idx = fromPane.tabs.findIndex((t) => t.id === tabId);
        newActiveTabId = fromTabs[Math.min(idx, fromTabs.length - 1)].id;
      }
      layout = replaceNode(layout, fromPane.id, {
        ...fromPane,
        tabs: fromTabs,
        activeTabId: newActiveTabId,
      });
    }

    const targetPane = findPane(layout, paneId);
    if (!targetPane) return paneId;

    const split: SplitNode = {
      type: 'split',
      id: createSplitId(),
      direction,
      children: [targetPane, newPane],
      sizes: [50, 50],
    };

    layout = replaceNode(layout, targetPane.id, split);

    this.update({ layout, focusedPaneId: newPaneId });
    return newPaneId;
  }

  closePane(paneId: PaneId): void {
    const state = this.state;
    const result = removePane(state.layout, paneId);

    if (!result) {
      this.update({
        ...state,
        layout: createDefaultWindowState().layout,
        focusedPaneId: (createDefaultWindowState().layout as PaneNode).id,
      });
      return;
    }

    const paneIds = collectPaneIds(result);
    const focusedPaneId = paneIds.includes(state.focusedPaneId)
      ? state.focusedPaneId
      : paneIds[0];

    this.update({ layout: result, focusedPaneId });
  }

  focusPane(paneId: PaneId): void {
    if (this.state.focusedPaneId === paneId) return;
    this.update({ ...this.state, focusedPaneId: paneId });
  }

  resizeSplit(splitId: string, sizes: number[]): void {
    const state = this.state;
    const node = findSplit(state.layout, splitId);
    if (!node) return;

    this.update({
      ...state,
      layout: replaceNode(state.layout, splitId, {
        ...node,
        sizes,
      }),
    });
  }

  updateTabTitle(tabId: TabId, title: string): void {
    const state = this.state;
    const pane = findPaneForTab(state.layout, tabId);
    if (!pane) return;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab || tab.title === title) return;

    this.update({
      ...state,
      layout: replaceNode(state.layout, pane.id, {
        ...pane,
        tabs: pane.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
      }),
    });
  }

  getPane(paneId: PaneId): PaneNode | null {
    return findPane(this.state.layout, paneId);
  }

  getFocusedPane(): PaneNode | null {
    return findPane(this.state.layout, this.state.focusedPaneId);
  }

  findTabByTarget(target: TabTarget): { tab: Tab; paneId: PaneId } | null {
    return findTabByTargetInLayout(this.state.layout, target);
  }
}

function findSplit(node: LayoutNode, splitId: string): SplitNode | null {
  if (node.type === 'pane') return null;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const found = findSplit(child, splitId);
    if (found) return found;
  }
  return null;
}

function findTabByTargetInLayout(
  node: LayoutNode,
  target: TabTarget,
): { tab: Tab; paneId: PaneId } | null {
  if (node.type === 'pane') {
    const tab = node.tabs.find((t) => targetsEqual(t.target, target));
    return tab ? { tab, paneId: node.id } : null;
  }
  for (const child of node.children) {
    const found = findTabByTargetInLayout(child, target);
    if (found) return found;
  }
  return null;
}
