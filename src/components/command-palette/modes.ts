import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Messages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { openNote } from '@/lib/note/navigation';
import type { Repository, VFSFileNode, VFSNode } from '@/lib/sync';
import type { TabStateController } from '@/lib/tabs/controller';
import type { CommandPaletteItem, CommandPaletteModeState } from './types';
import { createCommandPaletteSearchIndex } from './utils';

const logger = new Logger('CommandPalette');
const SEARCH_DEBOUNCE_MS = 150;

function isFileNode(node: VFSNode): node is VFSFileNode {
  return node.type === 'file';
}

interface NoteEntry {
  note: VFSFileNode;
  snippet: string | null;
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
  // Build the search index once per command set; searching it on each keystroke
  // avoids rebuilding the MiniSearch index (tokenizing every entry) per query.
  const searchIndex = useMemo(
    () => createCommandPaletteSearchIndex(commandItems),
    [commandItems],
  );

  return useMemo(
    () => ({
      emptyMessage: strings.commandPalette.noCommandResults,
      items: searchIndex.search(query).map((hit) => hit.item),
      loading: false,
      placeholder: strings.commandPalette.placeholder,
    }),
    [
      searchIndex,
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
  const [noteResults, setNoteResults] = useState<NoteEntry[]>([]);
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

    const loadEntries = (): Promise<NoteEntry[]> =>
      trimmed
        ? repository.searchNodes(trimmed).then((results) =>
            results
              .filter((result) => isFileNode(result.node))
              .map((result) => ({
                note: result.node as VFSFileNode,
                snippet: result.contentSnippet,
              })),
          )
        : repository
            .getRecentFiles(6)
            .then((notes) => notes.map((note) => ({ note, snippet: null })));

    const loadNotes = () => {
      setLoading(true);
      void loadEntries()
        .then((entries) => {
          if (requestId !== loadRequestRef.current) {
            return;
          }
          setNoteResults(entries);
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
    return noteResults.map(({ note, snippet }) => ({
      id: `note:${note.id}`,
      label: note.name,
      description:
        snippet ??
        (note.tags.length > 0
          ? note.tags.map((tag) => `#${tag}`).join(' ')
          : strings.commandPalette.noteResultDescription),
      section: trimmed
        ? strings.commandPalette.sections.notes
        : strings.commandPalette.sections.recent,
      icon: FileText,
      onSelect: () => {
        closePalette();
        openNote(tabController, note, note.name, 'search');
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
