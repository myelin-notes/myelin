import { describe, expect, it, vi } from 'vitest';
import type { NavigateFunction } from 'react-router-dom';
import { getNotePath, openNote } from './note-navigation';

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
});
