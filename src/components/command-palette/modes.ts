import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note-navigation';
import type { Repository, VFSFileNode, VFSNode } from '@/lib/sync';
import type { TabStateController } from '@/lib/tabs/controller';
import type { CommandPaletteItem, CommandPaletteModeState } from './types';
import { filterCommandPaletteEntries } from './utils';

const logger = new Logger('CommandPalette');
const SEARCH_DEBOUNCE_MS = 150;

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
  tabController,
  query,
  repository,
  strings,
}: {
  active: boolean;
  closePalette: () => void;
  tabController: TabStateController;
  query: string;
  repository: Repository;
  strings: Messages;
}): CommandPaletteModeState {
  const [noteResults, setNoteResults] = useState<VFSFileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    if (!active) {
      setNoteResults([]);
      setLoading(false);
      return;
    }

    const trimmed = query.trim();

    const loadNotes = () => {
      setLoading(true);
      void (
        trimmed ? repository.searchNodes(trimmed) : repository.getRecentFiles(6)
      )
        .then((nodes) => {
          if (requestId !== loadRequestRef.current) {
            return;
          }
          setNoteResults(nodes.filter(isFileNode));
        })
        .catch((error) => {
          if (requestId !== loadRequestRef.current) {
            return;
          }
          logger.error('Failed to load command palette notes', error, {
            query: trimmed,
          });
          setNoteResults([]);
        })
        .finally(() => {
          if (requestId === loadRequestRef.current) {
            setLoading(false);
          }
        });
    };

    if (!trimmed) {
      loadNotes();
      return () => {
        loadRequestRef.current++;
      };
    }

    setLoading(true);
    const timer = window.setTimeout(loadNotes, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      loadRequestRef.current++;
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
        openNote(tabController, note, note.name);
      },
    }));
  }, [
    closePalette,
    tabController,
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
