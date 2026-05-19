import { useEffect, useRef, useState } from 'react';
import { Logger } from '@/lib/logger';
import { type NoteBacklink, useRepository, type VFSNodeId } from '@/lib/sync';
import { renameNoteReferences } from '@/lib/sync/repo/rename-note-references';
import { UserPrefs } from '@/lib/user-prefs';
import { evaluateRenameDecision } from './rename-decision';

const logger = new Logger('ExplorerItem');

export type RenameReferencesChoice = 'always' | 'yes' | 'no' | 'cancel';

export interface RenameReferencesPrompt {
  mentionCount: number;
  noteCount: number;
}

interface PendingRenameReferencesPrompt extends RenameReferencesPrompt {
  oldName: string;
  newName: string;
  backlinks: NoteBacklink[];
}

interface UseExplorerItemOptions {
  nodeId: string;
  name: string;
  onChanged: () => void | Promise<void>;
  initialRenaming?: boolean;
  renameReferencesOnRename?: boolean;
}

export function useExplorerItem({
  nodeId,
  name,
  onChanged,
  initialRenaming,
  renameReferencesOnRename,
}: UseExplorerItemOptions) {
  const repository = useRepository();
  const [renaming, setRenaming] = useState(initialRenaming ?? false);
  const [renameValue, setRenameValue] = useState(name);
  const [pendingReferencesPrompt, setPendingReferencesPrompt] =
    useState<PendingRenameReferencesPrompt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInFlightRef = useRef(false);

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

  const commitRename = async (
    trimmed: string,
    options: {
      updateReferences: boolean;
      backlinks?: readonly NoteBacklink[];
    },
  ) => {
    try {
      await repository.renameNode(nodeId, trimmed);
      if (options.updateReferences) {
        await renameNoteReferences(
          repository,
          nodeId as VFSNodeId,
          trimmed,
          options.backlinks,
        );
      }
    } catch (err) {
      logger.error('Failed to rename node', err, { nodeId, trimmed });
    }
    setRenaming(false);
    await onChanged();
  };

  const loadBacklinks = async (): Promise<NoteBacklink[]> => {
    if (!renameReferencesOnRename) {
      return [];
    }
    try {
      return await repository.getBacklinks(nodeId as VFSNodeId);
    } catch (err) {
      logger.error('Failed to load backlinks before rename', err, { nodeId });
      return [];
    }
  };

  const handleRename = async () => {
    // Guards re-entry: handleRename runs on Enter and onBlur. When it sets
    // renaming=false the input unmounts, firing onBlur and re-invoking this.
    if (renameInFlightRef.current) {
      return;
    }

    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === name) {
      cancelRenaming();
      return;
    }

    renameInFlightRef.current = true;
    try {
      const backlinks = await loadBacklinks();
      const decision = evaluateRenameDecision(
        backlinks,
        UserPrefs.get('alwaysRenameNoteReferences'),
      );

      if (decision.kind === 'plain') {
        await commitRename(trimmed, { updateReferences: false });
      } else if (decision.kind === 'commit-with-refs') {
        await commitRename(trimmed, { updateReferences: true, backlinks });
      } else {
        setPendingReferencesPrompt({
          oldName: name,
          newName: trimmed,
          mentionCount: decision.mentionCount,
          noteCount: decision.noteCount,
          backlinks,
        });
        setRenaming(false);
      }
    } finally {
      renameInFlightRef.current = false;
    }
  };

  const chooseRenameReferences = async (choice: RenameReferencesChoice) => {
    if (renameInFlightRef.current) {
      return;
    }

    const pending = pendingReferencesPrompt;
    if (!pending) {
      return;
    }

    setPendingReferencesPrompt(null);
    if (choice === 'cancel') {
      return;
    }
    if (choice === 'always') {
      UserPrefs.set('alwaysRenameNoteReferences', true);
    }

    renameInFlightRef.current = true;
    try {
      await commitRename(pending.newName, {
        updateReferences: choice !== 'no',
        backlinks: pending.backlinks,
      });
    } finally {
      renameInFlightRef.current = false;
    }
  };

  const handleRemove = async () => {
    try {
      await repository.deleteNode(nodeId);
      onChanged();
    } catch (err) {
      logger.error('Failed to delete node', err, { nodeId });
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
    renameReferencesPrompt: pendingReferencesPrompt
      ? {
          mentionCount: pendingReferencesPrompt.mentionCount,
          noteCount: pendingReferencesPrompt.noteCount,
        }
      : null,
    chooseRenameReferences,
  };
}
