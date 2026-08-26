import { describe, expect, it } from 'vitest';
import { createWindowStateWithTab, TabStateController } from './controller';
import type { LayoutNode, PaneNode, SplitNode, WindowState } from './types';

function panesIn(node: LayoutNode): PaneNode[] {
  if (node.type === 'pane') {
    return [node];
  }
  return node.children.flatMap(panesIn);
}

function splitsIn(node: LayoutNode): SplitNode[] {
  if (node.type === 'pane') {
    return [];
  }
  return [node, ...node.children.flatMap(splitsIn)];
}

function expectValidWindowState(state: WindowState): void {
  const panes = panesIn(state.layout);
  const paneIds = new Set(panes.map((pane) => pane.id));
  const tabIds = new Set<string>();

  expect(panes.length).toBeGreaterThan(0);
  expect(paneIds.has(state.focusedPaneId)).toBe(true);

  for (const pane of panes) {
    // Panes show the home view either by being empty or by an empty activeTabId while tabs stay open;
    // otherwise activeTabId must point at a real tab.
    if (pane.tabs.length > 0 && pane.activeTabId !== '') {
      expect(pane.tabs.some((tab) => tab.id === pane.activeTabId)).toBe(true);
    }

    for (const tab of pane.tabs) {
      expect(tabIds.has(tab.id)).toBe(false);
      tabIds.add(tab.id);
    }
  }

  for (const split of splitsIn(state.layout)) {
    expect(split.children.length).toBe(split.sizes.length);
    expect(split.children.length).toBeGreaterThan(1);
  }
}

function focusedPane(controller: TabStateController): PaneNode {
  const pane = controller.getFocusedPane();
  expect(pane).not.toBeNull();
  return pane!;
}

function rootPane(controller: TabStateController): PaneNode {
  const state = controller.getSnapshot();
  expect(state.layout.type).toBe('pane');
  return state.layout as PaneNode;
}

function openCanvas(
  controller: TabStateController,
  id: string,
  title: string,
  paneId?: string,
): string {
  return controller.openTab({ type: 'canvas', id }, title, paneId);
}

function tabTitles(pane: PaneNode): string[] {
  return pane.tabs.map((tab) => tab.title);
}

describe('TabStateController', () => {
  it('starts as a single empty pane (the home view)', () => {
    const controller = new TabStateController();

    expectValidWindowState(controller.getSnapshot());
    expect(tabTitles(focusedPane(controller))).toEqual([]);
  });

  it('opens tabs after the active tab and reuses matching targets in the pane', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;

    const alphaId = openCanvas(controller, 'alpha', 'Alpha');
    openCanvas(controller, 'beta', 'Beta');
    controller.activateTab(alphaId, paneId);
    openCanvas(controller, 'gamma', 'Gamma');

    expect(tabTitles(rootPane(controller))).toEqual(['Alpha', 'Gamma', 'Beta']);

    const reopenedId = controller.openTab(
      {
        type: 'canvas',
        id: 'alpha',
        pageFrameName: 'Details',
        pageFrameId: 'frame-details',
      },
      'Alpha again',
      paneId,
    );

    const pane = rootPane(controller);
    const alpha = pane.tabs.find((tab) => tab.id === alphaId);
    expect(reopenedId).toBe(alphaId);
    expect(tabTitles(pane)).toEqual(['Alpha again', 'Gamma', 'Beta']);
    expect(alpha?.target).toMatchObject({
      type: 'canvas',
      id: 'alpha',
      pageFrameName: 'Details',
      pageFrameId: 'frame-details',
    });
    expect(pane.activeTabId).toBe(alphaId);
    expectValidWindowState(controller.getSnapshot());
  });

  it('reuses the workspace graph tab in the same pane', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;

    const firstId = controller.openTab({ type: 'graph' }, 'Graph', paneId);
    const secondId = controller.openTab(
      { type: 'graph' },
      'Graph again',
      paneId,
    );

    expect(secondId).toBe(firstId);
    expect(tabTitles(rootPane(controller))).toEqual(['Graph again']);
    expectValidWindowState(controller.getSnapshot());
  });

  it('replaces the pane tab instead of stacking when singleTab is set', () => {
    const controller = new TabStateController(undefined, undefined, {
      singleTab: true,
    });
    const paneId = focusedPane(controller).id;

    openCanvas(controller, 'alpha', 'Alpha', paneId);
    const betaId = openCanvas(controller, 'beta', 'Beta', paneId);

    const pane = rootPane(controller);
    expect(tabTitles(pane)).toEqual(['Beta']);
    expect(pane.activeTabId).toBe(betaId);

    // Reopening the live document still reuses its tab rather than recreating.
    const reopenedId = openCanvas(controller, 'beta', 'Beta again', paneId);
    expect(reopenedId).toBe(betaId);
    expect(tabTitles(rootPane(controller))).toEqual(['Beta again']);

    // Closing the only tab falls back to the home view, as on desktop.
    controller.closeTab(betaId, paneId);
    expect(tabTitles(focusedPane(controller))).toEqual([]);
    expectValidWindowState(controller.getSnapshot());
  });

  it('focuses an existing tab in another pane when navigating without a pane', () => {
    const controller = new TabStateController();
    const rootPaneId = focusedPane(controller).id;
    const alphaId = openCanvas(controller, 'alpha', 'Alpha', rootPaneId);
    const otherPaneId = controller.splitPane(rootPaneId, 'horizontal');
    controller.focusPane(otherPaneId);

    // No paneId => navigation: should reuse the tab in the root pane rather
    // than open a duplicate in the focused pane.
    const reopenedId = controller.openTab({ type: 'canvas', id: 'alpha' }, 'A');

    expect(reopenedId).toBe(alphaId);
    expect(tabTitles(controller.getPane(rootPaneId)!)).toEqual(['A']);
    expect(tabTitles(controller.getPane(otherPaneId)!)).toEqual([]);
    expect(controller.getSnapshot().focusedPaneId).toBe(rootPaneId);
    expectValidWindowState(controller.getSnapshot());
  });

  it('keeps an explicit pane scoped when a target is open elsewhere', () => {
    const controller = new TabStateController();
    const rootPaneId = focusedPane(controller).id;
    openCanvas(controller, 'alpha', 'Alpha', rootPaneId);
    const otherPaneId = controller.splitPane(rootPaneId, 'horizontal');

    const dupId = openCanvas(controller, 'alpha', 'Alpha copy', otherPaneId);

    expect(tabTitles(controller.getPane(otherPaneId)!)).toEqual(['Alpha copy']);
    expect(controller.getPane(otherPaneId)!.activeTabId).toBe(dupId);
    expectValidWindowState(controller.getSnapshot());
  });

  it('falls back to an empty home pane when the last tab is closed', () => {
    const controller = new TabStateController();
    const pane = focusedPane(controller);
    const alphaId = openCanvas(controller, 'alpha', 'Alpha');

    controller.closeTab(alphaId, pane.id);

    const nextPane = rootPane(controller);
    expect(tabTitles(nextPane)).toEqual([]);
    expect(controller.getSnapshot().focusedPaneId).toBe(nextPane.id);
    expectValidWindowState(controller.getSnapshot());
  });

  it('keeps active tabs valid while closing tabs', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    const alphaId = openCanvas(controller, 'alpha', 'Alpha');
    const betaId = openCanvas(controller, 'beta', 'Beta');
    const gammaId = openCanvas(controller, 'gamma', 'Gamma');

    controller.activateTab(betaId, paneId);
    controller.closeTab(betaId, paneId);
    expect(rootPane(controller).activeTabId).toBe(gammaId);

    controller.closeTab(gammaId, paneId);
    expect(rootPane(controller).activeTabId).toBe(alphaId);
    expectValidWindowState(controller.getSnapshot());
  });

  it('shows the home view without closing open tabs', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    const alphaId = openCanvas(controller, 'alpha', 'Alpha', paneId);
    openCanvas(controller, 'beta', 'Beta', paneId);

    controller.showHome(paneId);

    const pane = rootPane(controller);
    // Home is active (empty activeTabId survives re-normalization) and the tabs
    // are untouched.
    expect(pane.activeTabId).toBe('');
    expect(tabTitles(pane)).toEqual(['Alpha', 'Beta']);
    expectValidWindowState(controller.getSnapshot());

    // Selecting a tab leaves the home view again.
    controller.activateTab(alphaId, paneId);
    expect(rootPane(controller).activeTabId).toBe(alphaId);
  });

  it('stays on the home view when a background tab is closed', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    const alphaId = openCanvas(controller, 'alpha', 'Alpha', paneId);
    openCanvas(controller, 'beta', 'Beta', paneId);

    controller.showHome(paneId);
    controller.closeTab(alphaId, paneId);

    const pane = rootPane(controller);
    expect(pane.activeTabId).toBe('');
    expect(tabTitles(pane)).toEqual(['Beta']);
    expectValidWindowState(controller.getSnapshot());
  });

  it('reorders tabs using drop-slot indexes from the tab bar', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    openCanvas(controller, 'alpha', 'Alpha');
    const betaId = openCanvas(controller, 'beta', 'Beta');
    openCanvas(controller, 'gamma', 'Gamma');

    // Layout is [Alpha, Beta, Gamma] with Beta at index 1.
    // Dropping at the tab's own slot or the slot just after it is a no-op.
    controller.moveTab(betaId, paneId, paneId, 1);
    expect(tabTitles(rootPane(controller))).toEqual(['Alpha', 'Beta', 'Gamma']);

    controller.moveTab(betaId, paneId, paneId, 2);
    expect(tabTitles(rootPane(controller))).toEqual(['Alpha', 'Beta', 'Gamma']);

    controller.moveTab(betaId, paneId, paneId, 3);
    expect(tabTitles(rootPane(controller))).toEqual(['Alpha', 'Gamma', 'Beta']);

    controller.moveTab(betaId, paneId, paneId, 0);
    expect(tabTitles(rootPane(controller))).toEqual(['Beta', 'Alpha', 'Gamma']);
    expectValidWindowState(controller.getSnapshot());
  });

  it('moves a tab across panes and removes an emptied source pane', () => {
    const controller = new TabStateController();
    const rootPaneId = focusedPane(controller).id;
    openCanvas(controller, 'alpha', 'Alpha');
    const sourcePaneId = controller.splitPane(rootPaneId, 'horizontal');
    const movedTabId = openCanvas(controller, 'beta', 'Beta', sourcePaneId);

    controller.moveTab(movedTabId, sourcePaneId, rootPaneId, 1);

    const pane = rootPane(controller);
    expect(pane.id).toBe(rootPaneId);
    expect(tabTitles(pane)).toEqual(['Alpha', 'Beta']);
    expect(pane.activeTabId).toBe(movedTabId);
    expect(controller.getSnapshot().focusedPaneId).toBe(rootPaneId);
    expectValidWindowState(controller.getSnapshot());
  });

  it('splits a pane by moving a tab into the new pane', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    const alphaId = openCanvas(controller, 'alpha', 'Alpha');
    openCanvas(controller, 'beta', 'Beta');

    const newPaneId = controller.splitPaneWithTab(
      paneId,
      'horizontal',
      alphaId,
    );

    const state = controller.getSnapshot();
    expect(state.layout.type).toBe('split');
    expect(tabTitles(controller.getPane(paneId)!)).toEqual(['Beta']);
    expect(tabTitles(controller.getPane(newPaneId)!)).toEqual(['Alpha']);
    expect(state.focusedPaneId).toBe(newPaneId);
    expectValidWindowState(state);
  });

  it('can place a split tab before the target pane', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    const alphaId = openCanvas(controller, 'alpha', 'Alpha');
    openCanvas(controller, 'beta', 'Beta');

    const newPaneId = controller.splitPaneWithTab(
      paneId,
      'horizontal',
      alphaId,
      'before',
    );

    const state = controller.getSnapshot();
    const split = state.layout as SplitNode;
    expect(split.type).toBe('split');
    expect(split.children[0]!.id).toBe(newPaneId);
    expect(split.children[1]!.id).toBe(paneId);
    expectValidWindowState(state);
  });

  it('splits the only tab out of a pane by leaving an empty pane behind', () => {
    const controller = new TabStateController(
      createWindowStateWithTab({
        id: 'alpha-tab',
        target: { type: 'canvas', id: 'alpha' },
        title: 'Alpha',
      }),
    );
    const pane = focusedPane(controller);

    const returnedPaneId = controller.splitPaneWithTab(
      pane.id,
      'horizontal',
      pane.activeTabId,
    );

    const state = controller.getSnapshot();
    expect(state.layout.type).toBe('split');
    expect(returnedPaneId).not.toBe(pane.id);
    expect(tabTitles(controller.getPane(pane.id)!)).toEqual([]);
    expect(tabTitles(controller.getPane(returnedPaneId)!)).toEqual(['Alpha']);
    expect(state.focusedPaneId).toBe(returnedPaneId);
    expectValidWindowState(state);
  });

  it('closes tabs for deleted nodes across panes and leaves others alone', () => {
    const controller = new TabStateController();
    const rootPaneId = focusedPane(controller).id;
    openCanvas(controller, 'alpha', 'Alpha', rootPaneId);
    const betaId = openCanvas(controller, 'beta', 'Beta', rootPaneId);
    const otherPaneId = controller.splitPane(rootPaneId, 'horizontal');
    openCanvas(controller, 'gamma', 'Gamma', otherPaneId);

    // Deleting a folder reports every contained file id at once.
    controller.closeTabsForNodes(['alpha', 'gamma']);

    expect(tabTitles(controller.getPane(rootPaneId)!)).toEqual(['Beta']);
    expect(controller.getPane(rootPaneId)!.activeTabId).toBe(betaId);
    // The other pane emptied and collapsed, leaving a single pane.
    expect(controller.getSnapshot().layout.type).toBe('pane');
    expectValidWindowState(controller.getSnapshot());
  });

  it('ignores non-node tab targets and unknown ids when closing deleted nodes', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    controller.openTab({ type: 'graph' }, 'Graph', paneId);
    openCanvas(controller, 'alpha', 'Alpha', paneId);
    const before = controller.getSnapshot();

    // 'graph' is not node-backed and 'missing' matches nothing: both no-ops.
    controller.closeTabsForNodes(['graph', 'missing']);

    expect(controller.getSnapshot()).toBe(before);
    expect(tabTitles(rootPane(controller))).toEqual(['Graph', 'Alpha']);
    expectValidWindowState(controller.getSnapshot());
  });

  it('ignores invalid focus, activation, and resize requests', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    const splitPaneId = controller.splitPane(paneId, 'vertical');
    const split = controller.getSnapshot().layout as SplitNode;

    controller.resizeSplit(split.id, [70, 30]);
    expect((controller.getSnapshot().layout as SplitNode).sizes).toEqual([
      70, 30,
    ]);

    const before = controller.getSnapshot();
    controller.focusPane('missing-pane');
    controller.activateTab('missing-tab', paneId);
    controller.resizeSplit(split.id, [10]);

    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getPane(splitPaneId)).not.toBeNull();
    expectValidWindowState(controller.getSnapshot());
  });
});
