import { trackEvent } from '@/lib/analytics';
import type { VFSNodeId } from '@/lib/sync';
import type {
  LayoutNode,
  PaneId,
  PaneNode,
  PanePage,
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

function createPaneWithTabs(tabs: Tab[]): PaneNode {
  return {
    type: 'pane',
    id: createPaneId(),
    tabs,
    activeTabId: tabs[0]!.id,
  };
}

// A pane with no tabs renders the home view (recents + welcome) in its body.
// `activeTabId` is empty since there is no active tab to reference.
function createEmptyPane(): PaneNode {
  return {
    type: 'pane',
    id: createPaneId(),
    tabs: [],
    activeTabId: '',
  };
}

function targetsEqual(a: TabTarget, b: TabTarget): boolean {
  if (a.type !== b.type) {
    return false;
  }

  switch (a.type) {
    case 'graph':
    case 'settings':
      return true;
    case 'canvas':
      return a.id === (b as Extract<TabTarget, { type: 'canvas' }>).id;
    case 'image':
      return a.id === (b as Extract<TabTarget, { type: 'image' }>).id;
    case 'csv':
      return a.id === (b as Extract<TabTarget, { type: 'csv' }>).id;
  }
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) {
    return max;
  }
  return Math.min(Math.max(Math.trunc(index), 0), max);
}

function insertAt<T>(items: T[], item: T, index: number): T[] {
  const insertIndex = clampIndex(index, items.length);
  return [...items.slice(0, insertIndex), item, ...items.slice(insertIndex)];
}

function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

function normalizeSizes(sizes: number[], count: number): number[] {
  if (
    sizes.length !== count ||
    sizes.some((size) => !Number.isFinite(size) || size <= 0)
  ) {
    return evenSizes(count);
  }

  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) {
    return evenSizes(count);
  }
  return sizes.map((size) => (size / total) * 100);
}

function normalizePane(pane: PaneNode): PaneNode {
  // Empty panes are valid: they render the home view. Keep activeTabId empty.
  if (pane.tabs.length === 0) {
    return pane.activeTabId === '' ? pane : { ...pane, activeTabId: '' };
  }

  // An empty activeTabId is the intentional home view (see showHome). Preserve it even while tabs
  // are open, or this snaps back to the first tab and the home button appears to do nothing.
  if (pane.activeTabId === '') {
    return pane;
  }

  if (pane.tabs.some((tab) => tab.id === pane.activeTabId)) {
    return pane;
  }

  return {
    ...pane,
    activeTabId: pane.tabs[0]!.id,
  };
}

function normalizeLayout(node: LayoutNode): LayoutNode {
  if (node.type === 'pane') {
    return normalizePane(node);
  }

  const children = node.children.map(normalizeLayout);
  if (children.length === 0) {
    return createEmptyPane();
  }
  if (children.length === 1) {
    return children[0]!;
  }

  return {
    ...node,
    children,
    sizes: normalizeSizes(node.sizes, children.length),
  };
}

function collectPaneIds(node: LayoutNode): PaneId[] {
  if (node.type === 'pane') {
    return [node.id];
  }
  return node.children.flatMap(collectPaneIds);
}

function countTabs(node: LayoutNode): number {
  if (node.type === 'pane') {
    return node.tabs.length;
  }
  return node.children.reduce((sum, child) => sum + countTabs(child), 0);
}

function normalizeWindowState(state: WindowState): WindowState {
  const layout = normalizeLayout(state.layout);
  const paneIds = collectPaneIds(layout);
  const focusedPaneId = paneIds.includes(state.focusedPaneId)
    ? state.focusedPaneId
    : paneIds[0]!;

  if (layout === state.layout && focusedPaneId === state.focusedPaneId) {
    return state;
  }

  return {
    layout,
    focusedPaneId,
  };
}

function findPane(node: LayoutNode, paneId: PaneId): PaneNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }

  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) {
      return found;
    }
  }

  return null;
}

export function findPaneInLayout(
  node: LayoutNode,
  paneId: PaneId,
): PaneNode | null {
  return findPane(node, paneId);
}

function findPaneForTab(node: LayoutNode, tabId: TabId): PaneNode | null {
  if (node.type === 'pane') {
    return node.tabs.some((tab) => tab.id === tabId) ? node : null;
  }

  for (const child of node.children) {
    const found = findPaneForTab(child, tabId);
    if (found) {
      return found;
    }
  }

  return null;
}

function findFirstPane(node: LayoutNode): PaneNode {
  if (node.type === 'pane') {
    return node;
  }
  return findFirstPane(node.children[0]!);
}

function findSplit(node: LayoutNode, splitId: string): SplitNode | null {
  if (node.type === 'pane') {
    return null;
  }
  if (node.id === splitId) {
    return node;
  }

  for (const child of node.children) {
    const found = findSplit(child, splitId);
    if (found) {
      return found;
    }
  }

  return null;
}

function replaceNode(
  root: LayoutNode,
  targetId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (root.id === targetId) {
    return replacement;
  }

  if (root.type === 'pane') {
    return root;
  }

  const children = root.children.map((child) =>
    replaceNode(child, targetId, replacement),
  );

  if (children.every((child, index) => child === root.children[index])) {
    return root;
  }

  return {
    ...root,
    children,
  };
}

function replacePane(root: LayoutNode, pane: PaneNode): LayoutNode {
  return replaceNode(root, pane.id, pane);
}

function compactSplit(split: SplitNode): LayoutNode | null {
  if (split.children.length === 0) {
    return null;
  }
  if (split.children.length === 1) {
    return split.children[0]!;
  }
  return {
    ...split,
    sizes: normalizeSizes(split.sizes, split.children.length),
  };
}

function removePane(root: LayoutNode, paneId: PaneId): LayoutNode | null {
  if (root.type === 'pane') {
    return root.id === paneId ? null : root;
  }

  const children: LayoutNode[] = [];
  const sizes: number[] = [];

  for (let index = 0; index < root.children.length; index++) {
    const child = removePane(root.children[index]!, paneId);
    if (child) {
      children.push(child);
      sizes.push(root.sizes[index] ?? 0);
    }
  }

  return compactSplit({
    ...root,
    children,
    sizes,
  });
}

function activeTabAfterRemoving(
  pane: PaneNode,
  removedTabId: TabId,
  removedIndex: number,
  tabs: Tab[],
): TabId {
  if (pane.activeTabId !== removedTabId) {
    return pane.activeTabId;
  }

  return tabs[Math.min(removedIndex, tabs.length - 1)]!.id;
}

function findTabByTargetInLayout(
  node: LayoutNode,
  target: TabTarget,
): { tab: Tab; paneId: PaneId } | null {
  if (node.type === 'pane') {
    const tab = node.tabs.find((candidate) =>
      targetsEqual(candidate.target, target),
    );
    return tab ? { tab, paneId: node.id } : null;
  }

  for (const child of node.children) {
    const found = findTabByTargetInLayout(child, target);
    if (found) {
      return found;
    }
  }

  return null;
}

export function createDefaultWindowState(): WindowState {
  const pane = createEmptyPane();
  return {
    layout: pane,
    focusedPaneId: pane.id,
  };
}

export function createWindowStateWithTab(tab: Tab): WindowState {
  const pane = createPaneWithTabs([tab]);
  return {
    layout: pane,
    focusedPaneId: pane.id,
  };
}

export interface TabControllerOptions {
  // Opening a document replaces the pane's current tab instead of stacking beside it. Set on phone
  // layouts, which have no tab strip to switch or close with.
  singleTab?: boolean;
}

export class TabStateController {
  private state: WindowState;
  private readonly listeners = new Set<() => void>();
  private readonly onEmpty?: () => void;
  private readonly singleTab: boolean;

  // `onEmpty` runs when the last pane is closed. The window layer uses it to close the native
  // window; without it the window falls back to a fresh default state (used by tests).
  constructor(
    initialState?: WindowState,
    onEmpty?: () => void,
    options?: TabControllerOptions,
  ) {
    this.state = initialState
      ? normalizeWindowState(initialState)
      : createDefaultWindowState();
    this.onEmpty = onEmpty;
    this.singleTab = options?.singleTab ?? false;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WindowState => this.state;

  replaceState(state: WindowState): void {
    this.commit(state);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private commit(next: WindowState): void {
    this.state = normalizeWindowState(next);
    this.emit();
  }

  openTab(target: TabTarget, title: string, paneId?: PaneId): TabId {
    const state = this.state;
    const preferredPaneId = paneId ?? state.focusedPaneId;
    const pane =
      findPane(state.layout, preferredPaneId) ?? findFirstPane(state.layout);
    // With no pane specified the caller is navigating to a document (link, command palette, dropped
    // tab), so focus any existing tab anywhere to avoid two live editors on the same node. An explicit
    // paneId is a deliberate placement and stays scoped to that pane.
    const match =
      paneId === undefined
        ? findTabByTargetInLayout(state.layout, target)
        : (() => {
            const tab = pane.tabs.find((candidate) =>
              targetsEqual(candidate.target, target),
            );
            return tab ? { tab, paneId: pane.id } : null;
          })();

    if (match) {
      const matchPane = findPane(state.layout, match.paneId)!;
      this.commit({
        layout: replacePane(state.layout, {
          ...matchPane,
          tabs: matchPane.tabs.map((tab) =>
            tab.id === match.tab.id ? { ...tab, target, title } : tab,
          ),
          activeTabId: match.tab.id,
          activePage: undefined,
        }),
        focusedPaneId: matchPane.id,
      });
      trackEvent('tab_opened', {
        target_type: target.type,
        is_new_document: false,
      });
      return match.tab.id;
    }

    const tab: Tab = {
      id: createTabId(),
      target,
      title,
    };
    const activeIndex = pane.tabs.findIndex(
      (candidate) => candidate.id === pane.activeTabId,
    );
    const insertIndex = activeIndex === -1 ? pane.tabs.length : activeIndex + 1;
    // Single-tab panes show one document at a time, so the new tab takes the
    // pane over rather than joining a strip the user can't see.
    const nextPane: PaneNode = {
      ...pane,
      tabs: this.singleTab ? [tab] : insertAt(pane.tabs, tab, insertIndex),
      activeTabId: tab.id,
      activePage: undefined,
    };

    this.commit({
      layout: replacePane(state.layout, nextPane),
      focusedPaneId: pane.id,
    });

    trackEvent('tab_opened', {
      target_type: target.type,
      is_new_document: true,
    });
    return tab.id;
  }

  // Graph/settings tabs are not node-backed and are left alone. Panes emptied by this collapse the
  // same way a manual close does.
  closeTabsForNodes(nodeIds: Iterable<VFSNodeId>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) {
      return;
    }

    const matches: { tabId: TabId; paneId: PaneId }[] = [];
    const collect = (node: LayoutNode): void => {
      if (node.type === 'pane') {
        for (const tab of node.tabs) {
          const { target } = tab;
          if (
            (target.type === 'canvas' ||
              target.type === 'image' ||
              target.type === 'csv') &&
            ids.has(target.id)
          ) {
            matches.push({ tabId: tab.id, paneId: node.id });
          }
        }
        return;
      }
      node.children.forEach(collect);
    };
    collect(this.state.layout);

    for (const { tabId, paneId } of matches) {
      this.closeTab(tabId, paneId);
    }
  }

  closeTab(tabId: TabId, paneId: PaneId): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) {
      return;
    }

    const removedIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (removedIndex === -1) {
      return;
    }

    const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length === 0) {
      this.closePane(paneId);
      return;
    }

    const nextPane: PaneNode = {
      ...pane,
      tabs,
      activeTabId: activeTabAfterRemoving(pane, tabId, removedIndex, tabs),
    };

    this.commit({
      ...state,
      layout: replacePane(state.layout, nextPane),
    });
  }

  activateTab(tabId: TabId, paneId: PaneId): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane?.tabs.some((tab) => tab.id === tabId)) {
      return;
    }

    if (
      pane.activeTabId === tabId &&
      state.focusedPaneId === paneId &&
      pane.activePage === undefined
    ) {
      return;
    }

    this.commit({
      layout: replacePane(state.layout, {
        ...pane,
        activeTabId: tabId,
        activePage: undefined,
      }),
      focusedPaneId: paneId,
    });
  }

  togglePanePage(page: PanePage, paneId?: PaneId): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId ?? state.focusedPaneId);
    if (!pane) {
      return;
    }

    this.commit({
      layout: replacePane(state.layout, {
        ...pane,
        activePage: pane.activePage === page ? undefined : page,
      }),
      focusedPaneId: pane.id,
    });
  }

  // Falls back to the empty-pane home view (activeTabId === '') without closing any tabs. Used by
  // the mobile layout's library button.
  showHome(paneId: PaneId): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane || (pane.activeTabId === '' && pane.activePage === undefined)) {
      return;
    }

    this.commit({
      layout: replacePane(state.layout, {
        ...pane,
        activeTabId: '',
        activePage: undefined,
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
    if (!fromPane || !toPane) {
      return;
    }

    const movedIndex = fromPane.tabs.findIndex((tab) => tab.id === tabId);
    if (movedIndex === -1) {
      return;
    }

    const tab = fromPane.tabs[movedIndex]!;
    const fromTabs = fromPane.tabs.filter(
      (candidate) => candidate.id !== tabId,
    );
    let layout = state.layout;

    if (fromTabs.length === 0) {
      const nextLayout = removePane(layout, fromPaneId);
      if (!nextLayout) {
        return;
      }
      layout = nextLayout;
    } else {
      layout = replacePane(layout, {
        ...fromPane,
        tabs: fromTabs,
        activeTabId: activeTabAfterRemoving(
          fromPane,
          tabId,
          movedIndex,
          fromTabs,
        ),
      });
    }

    const targetPane = findPane(layout, toPaneId);
    if (!targetPane) {
      return;
    }

    const nextTargetPane: PaneNode = {
      ...targetPane,
      tabs: insertAt(targetPane.tabs, tab, index),
      activeTabId: tabId,
      activePage: undefined,
    };

    this.commit({
      layout: replacePane(layout, nextTargetPane),
      focusedPaneId: targetPane.id,
    });
  }

  private reorderTab(tabId: TabId, paneId: PaneId, index: number): void {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) {
      return;
    }

    const oldIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (oldIndex === -1) {
      return;
    }

    const dropIndex = clampIndex(index, pane.tabs.length);
    if (dropIndex === oldIndex || dropIndex === oldIndex + 1) {
      return;
    }

    const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
    const insertIndex = dropIndex > oldIndex ? dropIndex - 1 : dropIndex;
    const nextPane: PaneNode = {
      ...pane,
      tabs: insertAt(tabs, pane.tabs[oldIndex]!, insertIndex),
    };

    this.commit({
      ...state,
      layout: replacePane(state.layout, nextPane),
    });
  }

  splitPane(
    paneId: PaneId,
    direction: SplitDirection,
    placement: 'before' | 'after' = 'after',
  ): PaneId {
    const state = this.state;
    const pane = findPane(state.layout, paneId);
    if (!pane) {
      return paneId;
    }

    const newPane = createEmptyPane();
    const split: SplitNode = {
      type: 'split',
      id: createSplitId(),
      direction,
      children: placement === 'before' ? [newPane, pane] : [pane, newPane],
      sizes: [50, 50],
    };

    this.commit({
      ...state,
      layout: replaceNode(state.layout, pane.id, split),
    });

    trackEvent('pane_split', { direction });

    return newPane.id;
  }

  splitPaneWithTab(
    paneId: PaneId,
    direction: SplitDirection,
    tabId: TabId,
    placement: 'before' | 'after' = 'after',
  ): PaneId {
    const state = this.state;
    const sourcePane = findPaneForTab(state.layout, tabId);
    const targetPane = findPane(state.layout, paneId);
    if (!sourcePane || !targetPane) {
      return paneId;
    }

    const tabIndex = sourcePane.tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) {
      return paneId;
    }

    const tab = sourcePane.tabs[tabIndex]!;
    const sourceTabs = sourcePane.tabs.filter(
      (candidate) => candidate.id !== tabId,
    );
    let layout = state.layout;

    if (sourceTabs.length === 0 && sourcePane.id !== targetPane.id) {
      const nextLayout = removePane(layout, sourcePane.id);
      if (!nextLayout) {
        return paneId;
      }
      layout = nextLayout;
    } else {
      layout = replacePane(layout, {
        ...sourcePane,
        tabs: sourceTabs,
        activeTabId:
          sourceTabs.length === 0
            ? sourcePane.activeTabId
            : activeTabAfterRemoving(sourcePane, tabId, tabIndex, sourceTabs),
      });
    }

    const splitTargetPane = findPane(layout, targetPane.id);
    if (!splitTargetPane) {
      return paneId;
    }

    const newPane: PaneNode = {
      type: 'pane',
      id: createPaneId(),
      tabs: [tab],
      activeTabId: tab.id,
    };
    const split: SplitNode = {
      type: 'split',
      id: createSplitId(),
      direction,
      children:
        placement === 'before'
          ? [newPane, splitTargetPane]
          : [splitTargetPane, newPane],
      sizes: [50, 50],
    };

    layout = replaceNode(layout, splitTargetPane.id, split);
    this.commit({
      layout,
      focusedPaneId: newPane.id,
    });

    return newPane.id;
  }

  closePane(paneId: PaneId): void {
    const state = this.state;
    const layout = removePane(state.layout, paneId);

    if (!layout) {
      if (this.onEmpty) {
        this.onEmpty();
        return;
      }
      this.commit(createDefaultWindowState());
      return;
    }

    const paneIds = collectPaneIds(layout);
    this.commit({
      layout,
      focusedPaneId: paneIds.includes(state.focusedPaneId)
        ? state.focusedPaneId
        : paneIds[0]!,
    });
  }

  focusPane(paneId: PaneId): void {
    if (this.state.focusedPaneId === paneId) {
      return;
    }
    if (!findPane(this.state.layout, paneId)) {
      return;
    }

    this.commit({
      ...this.state,
      focusedPaneId: paneId,
    });
  }

  resizeSplit(splitId: string, sizes: number[]): void {
    const state = this.state;
    const split = findSplit(state.layout, splitId);
    if (!split || sizes.length !== split.children.length) {
      return;
    }
    if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
      return;
    }

    this.commit({
      ...state,
      layout: replaceNode(state.layout, splitId, {
        ...split,
        sizes: normalizeSizes(sizes, split.children.length),
      }),
    });
  }

  updateTabTitle(tabId: TabId, title: string): void {
    const state = this.state;
    const pane = findPaneForTab(state.layout, tabId);
    if (!pane) {
      return;
    }

    const tab = pane.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.title === title) {
      return;
    }

    this.commit({
      ...state,
      layout: replacePane(state.layout, {
        ...pane,
        tabs: pane.tabs.map((candidate) =>
          candidate.id === tabId ? { ...candidate, title } : candidate,
        ),
      }),
    });
  }

  getPane(paneId: PaneId): PaneNode | null {
    return findPane(this.state.layout, paneId);
  }

  getFocusedPane(): PaneNode | null {
    return findPane(this.state.layout, this.state.focusedPaneId);
  }

  getTotalTabCount(): number {
    return countTabs(this.state.layout);
  }

  findTabByTarget(target: TabTarget): { tab: Tab; paneId: PaneId } | null {
    return findTabByTargetInLayout(this.state.layout, target);
  }
}
