import { useEffect, useRef, useState } from 'react';
import { repository } from '@/lib/repository';

interface UseExplorerItemOptions {
  nodeId: string;
  name: string;
  onChanged: () => void;
  initialRenaming?: boolean;
}

export function useExplorerItem({
  nodeId,
  name,
  onChanged,
  initialRenaming,
}: UseExplorerItemOptions) {
  const [renaming, setRenaming] = useState(initialRenaming ?? false);
  const [renameValue, setRenameValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const startRenaming = () => {
    setRenameValue(name);
    setRenaming(true);
  };

  const cancelRenaming = () => {
    setRenaming(false);
    setRenameValue(name);
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === name) {
      cancelRenaming();
      return;
    }
    try {
      await repository.renameNode(nodeId, trimmed);
    } catch (err) {
      console.error('Failed to rename:', err);
    }
    setRenaming(false);
    onChanged();
  };

  const handleRemove = async () => {
    try {
      await repository.deleteNode(nodeId);
      onChanged();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'application/myelin-item',
      JSON.stringify({ nodeId }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  const renameInputProps = {
    ref: inputRef,
    value: renameValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setRenameValue(e.target.value),
    onBlur: handleRename,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleRename();
      }
      if (e.key === 'Escape') {
        cancelRenaming();
      }
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  return {
    renaming,
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
  };
}
