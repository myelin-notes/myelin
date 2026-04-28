import type { NavigateFunction } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { getNotePath, openNote, openNoteLink } from './note-navigation';

describe('note navigation', () => {
  it('builds a note path from file type and id', () => {
    expect(getNotePath({ fileType: 'mcanvas', id: 'note-123' })).toBe(
      '/mcanvas/note-123',
    );
  });

  it('opens notes with a view transition', () => {
    const navigate = vi.fn() as unknown as NavigateFunction;

    openNote(navigate, { fileType: 'mcanvas', id: 'note-123' });

    expect(navigate).toHaveBeenCalledWith('/mcanvas/note-123', {
      viewTransition: true,
    });
  });

  it('opens resolved note links without creating a note', async () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    const repository = {
      getNode: vi.fn(),
      createFile: vi.fn(),
    };

    await openNoteLink(navigate, repository, 'current-note', {
      title: 'Alpha Note',
      noteId: 'note-123',
    });

    expect(repository.getNode).not.toHaveBeenCalled();
    expect(repository.createFile).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/mcanvas/note-123', {
      viewTransition: true,
    });
  });

  it('creates unresolved note links in the current note directory before opening', async () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
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

    await openNoteLink(navigate, repository, 'current-note', {
      title: 'Alpha Note',
      noteId: null,
    });

    expect(repository.getNode).toHaveBeenCalledWith('current-note');
    expect(repository.createFile).toHaveBeenCalledWith(
      'Alpha Note',
      'mcanvas',
      'folder-1',
    );
    expect(navigate).toHaveBeenCalledWith('/mcanvas/created-note', {
      viewTransition: true,
    });
  });
});
