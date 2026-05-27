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
    expect(pane.tabs.length).toBeGreaterThan(0);
    expect(pane.tabs.some((tab) => tab.id === pane.activeTabId)).toBe(true);

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
  it('starts with a focused library tab', () => {
    const controller = new TabStateController();

    expectValidWindowState(controller.getSnapshot());
    expect(tabTitles(focusedPane(controller))).toEqual(['Library']);
  });

  it('opens tabs after the active tab and reuses matching targets in the pane', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;

    const alphaId = openCanvas(controller, 'alpha', 'Alpha');
    openCanvas(controller, 'beta', 'Beta');
    controller.activateTab(alphaId, paneId);
    openCanvas(controller, 'gamma', 'Gamma');

    expect(tabTitles(rootPane(controller))).toEqual([
      'Library',
      'Alpha',
      'Gamma',
      'Beta',
    ]);

    const reopenedId = controller.openTab(
      { type: 'canvas', id: 'alpha', pageFrameName: 'Details' },
      'Alpha again',
      paneId,
    );

    const pane = rootPane(controller);
    expect(reopenedId).toBe(alphaId);
    expect(tabTitles(pane)).toEqual(['Library', 'Alpha', 'Gamma', 'Beta']);
    expect(pane.activeTabId).toBe(alphaId);
    expectValidWindowState(controller.getSnapshot());
  });

  it('replaces the last closed pane with a valid default state', () => {
    const controller = new TabStateController();
    const pane = focusedPane(controller);

    controller.closeTab(pane.activeTabId, pane.id);

    const nextPane = rootPane(controller);
    expect(tabTitles(nextPane)).toEqual(['Library']);
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

  it('reorders tabs using drop-slot indexes from the tab bar', () => {
    const controller = new TabStateController();
    const paneId = focusedPane(controller).id;
    openCanvas(controller, 'alpha', 'Alpha');
    const betaId = openCanvas(controller, 'beta', 'Beta');
    openCanvas(controller, 'gamma', 'Gamma');

    controller.moveTab(betaId, paneId, paneId, 3);
    expect(tabTitles(rootPane(controller))).toEqual([
      'Library',
      'Alpha',
      'Beta',
      'Gamma',
    ]);

    controller.moveTab(betaId, paneId, paneId, 4);
    expect(tabTitles(rootPane(controller))).toEqual([
      'Library',
      'Alpha',
      'Gamma',
      'Beta',
    ]);

    controller.moveTab(betaId, paneId, paneId, 0);
    expect(tabTitles(rootPane(controller))).toEqual([
      'Beta',
      'Library',
      'Alpha',
      'Gamma',
    ]);
    expectValidWindowState(controller.getSnapshot());
  });

  it('moves a tab across panes and removes an emptied source pane', () => {
    const controller = new TabStateController();
    const rootPaneId = focusedPane(controller).id;
    openCanvas(controller, 'alpha', 'Alpha');
    const sourcePaneId = controller.splitPane(rootPaneId, 'horizontal');
    const movedTabId = controller.getPane(sourcePaneId)!.activeTabId;

    controller.moveTab(movedTabId, sourcePaneId, rootPaneId, 1);

    const pane = rootPane(controller);
    expect(pane.id).toBe(rootPaneId);
    expect(tabTitles(pane)).toEqual(['Library', 'Library', 'Alpha']);
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
    expect(tabTitles(controller.getPane(paneId)!)).toEqual(['Library', 'Beta']);
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

  it('splits the only tab out of a pane by leaving a default tab behind', () => {
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
    expect(tabTitles(controller.getPane(pane.id)!)).toEqual(['Library']);
    expect(tabTitles(controller.getPane(returnedPaneId)!)).toEqual(['Alpha']);
    expect(state.focusedPaneId).toBe(returnedPaneId);
    expectValidWindowState(state);
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
