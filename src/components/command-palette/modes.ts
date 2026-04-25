import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { Messages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note-navigation';
import type { Repository, VFSFileNode, VFSNode } from '@/lib/sync';
import type { CommandPaletteItem, CommandPaletteModeState } from './types';
import { filterCommandPaletteEntries } from './utils';

const logger = new Logger('CommandPalette');

function isFileNode(node: VFSNode): node is VFSFileNode {
  return node.type === 'file';
}

export function useCommandMode({
  commandItems,
  query,
  strings,
}: {
  commandItems: CommandPaletteItem[];
  query: string;
  strings: Messages;
}): CommandPaletteModeState {
  return useMemo(
    () => ({
      emptyMessage: strings.commandPalette.noCommandResults,
      items: filterCommandPaletteEntries(commandItems, query),
      loading: false,
      placeholder: strings.commandPalette.placeholder,
    }),
    [
      commandItems,
      query,
      strings.commandPalette.noCommandResults,
      strings.commandPalette.placeholder,
    ],
  );
}

export function useNotesMode({
  active,
  closePalette,
  navigate,
  query,
  repository,
  strings,
}: {
  active: boolean;
  closePalette: () => void;
  navigate: NavigateFunction;
  query: string;
  repository: Repository;
  strings: Messages;
}): CommandPaletteModeState {
  const [noteResults, setNoteResults] = useState<VFSFileNode[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) {
      setNoteResults([]);
      setLoading(false);
      return;
    }

    let disposed = false;
    const trimmed = query.trim();

    setLoading(true);
    void (
      trimmed ? repository.searchNodes(trimmed) : repository.getRecentFiles(6)
    )
      .then((nodes) => {
        if (disposed) {
          return;
        }
        setNoteResults(nodes.filter(isFileNode));
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        logger.error('Failed to load command palette notes', error, {
          query: trimmed,
        });
        setNoteResults([]);
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [active, query, repository]);

  const items = useMemo<CommandPaletteItem[]>(() => {
    const trimmed = query.trim();
    return noteResults.map((note) => ({
      id: `note:${note.id}`,
      label: note.name,
      description:
        note.tags.length > 0
          ? note.tags.map((tag) => `#${tag}`).join(' ')
          : strings.commandPalette.noteResultDescription,
      section: trimmed
        ? strings.commandPalette.sections.notes
        : strings.commandPalette.sections.recent,
      icon: FileText,
      onSelect: () => {
        closePalette();
        openNote(navigate, note);
      },
    }));
  }, [
    closePalette,
    navigate,
    noteResults,
    query,
    strings.commandPalette.noteResultDescription,
    strings.commandPalette.sections.notes,
    strings.commandPalette.sections.recent,
  ]);

  return {
    emptyMessage: strings.commandPalette.noNoteResults,
    items,
    loading,
    placeholder: strings.commandPalette.searchPlaceholder,
  };
}
