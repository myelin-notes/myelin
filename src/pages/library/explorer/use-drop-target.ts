import { useRef, useState } from 'react';
import { repository } from '@/lib/repository';

interface UseDropTargetOptions {
  targetFolderId: string | null;
  onMoved: () => void;
}

export function useDropTarget({
  targetFolderId,
  onMoved,
}: UseDropTargetOptions) {
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/myelin-item')) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/myelin-item')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setDragOver(false);

    const raw = e.dataTransfer.getData('application/myelin-item');
    if (!raw) {
      return;
    }

    const { nodeId } = JSON.parse(raw) as { nodeId: string };

    // Don't drop onto self
    if (nodeId === targetFolderId) {
      return;
    }

    try {
      await repository.moveNode(nodeId, targetFolderId);
      onMoved();
    } catch (err) {
      console.error('Failed to move item:', err);
    }
  };

  return {
    dragOver,
    dropTargetProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
