import { describe, expect, it, vi } from 'vitest';
import { TabStateController } from '@/lib/tabs/controller';
import { openNote, openNoteLink } from './navigation';

describe('note navigation', () => {
  it('opens a canvas note as a tab', () => {
    const controller = new TabStateController();
    openNote(
      controller,
      { fileType: 'mcanvas', id: 'note-123' },
      undefined,
      'explorer',
    );

    const state = controller.getSnapshot();
    const pane = state.layout.type === 'pane' ? state.layout : null;
    expect(pane).not.toBeNull();
    const tab = pane!.tabs.find(
      (t) => t.target.type === 'canvas' && t.target.id === 'note-123',
    );
    expect(tab).toBeDefined();
    expect(pane!.activeTabId).toBe(tab!.id);
  });

  it('opens resolved note links without creating a note', async () => {
    const controller = new TabStateController();
    const repository = {
      getNode: vi.fn(),
      createFile: vi.fn(),
    };

    await openNoteLink(controller, repository, 'current-note', {
      title: 'Alpha Note',
      noteId: 'note-123',
    });

    expect(repository.getNode).not.toHaveBeenCalled();
    expect(repository.createFile).not.toHaveBeenCalled();

    const state = controller.getSnapshot();
    const pane = state.layout.type === 'pane' ? state.layout : null;
    const tab = pane!.tabs.find(
      (t) => t.target.type === 'canvas' && t.target.id === 'note-123',
    );
    expect(tab).toBeDefined();
  });

  it('opens resolved note links with page-frame targets', async () => {
    const controller = new TabStateController();
    const repository = {
      getNode: vi.fn(),
      createFile: vi.fn(),
    };

    await openNoteLink(controller, repository, 'current-note', {
      title: 'Alpha Note#Research Notes',
      noteId: 'note-123',
    });

    expect(repository.getNode).not.toHaveBeenCalled();
    expect(repository.createFile).not.toHaveBeenCalled();

    const state = controller.getSnapshot();
    const pane = state.layout.type === 'pane' ? state.layout : null;
    const tab = pane!.tabs.find(
      (t) =>
        t.target.type === 'canvas' &&
        t.target.id === 'note-123' &&
        t.target.pageFrameName === 'Research Notes',
    );
    expect(tab).toBeDefined();
  });

  it('preserves resolved page-frame ids when opening note links', async () => {
    const controller = new TabStateController();
    const repository = {
      getNode: vi.fn(),
      createFile: vi.fn(),
    };

    await openNoteLink(controller, repository, 'current-note', {
      title: 'Alpha Note#Research Notes',
      noteId: 'note-123',
      pageFrameId: 'frame-123',
    });

    const state = controller.getSnapshot();
    const pane = state.layout.type === 'pane' ? state.layout : null;
    const tab = pane!.tabs.find(
      (t) =>
        t.target.type === 'canvas' &&
        t.target.id === 'note-123' &&
        t.target.pageFrameName === 'Research Notes' &&
        t.target.pageFrameId === 'frame-123',
    );
    expect(tab).toBeDefined();
  });

  it('creates unresolved note links before opening', async () => {
    const controller = new TabStateController();
    const repository = {
      getNode: vi.fn().mockResolvedValue({
        id: 'current-note',
        name: 'Current Note',
        type: 'file',
        fileType: 'mcanvas',
        parentId: 'folder-1',
        tags: [],
        createdAt: 0,
        modifiedAt: 0,
      }),
      createFile: vi.fn().mockResolvedValue('created-note'),
    };

    await openNoteLink(controller, repository, 'current-note', {
      title: 'Alpha Note#Research Notes',
      noteId: null,
    });

    expect(repository.getNode).toHaveBeenCalledWith('current-note');
    expect(repository.createFile).toHaveBeenCalledWith(
      'Alpha Note',
      'mcanvas',
      'folder-1',
    );

    const state = controller.getSnapshot();
    const pane = state.layout.type === 'pane' ? state.layout : null;
    const tab = pane!.tabs.find(
      (t) =>
        t.target.type === 'canvas' &&
        t.target.id === 'created-note' &&
        t.target.pageFrameName === 'Research Notes',
    );
    expect(tab).toBeDefined();
  });
});
