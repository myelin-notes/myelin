import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useKeybindings } from '@/hooks/useKeybindings';
import { useMessages } from '@/lib/i18n';
import { type Action, type ActionBinding, keybindings } from '@/lib/keybinds';
import { Logger } from '@/lib/logger';
import { useRepository, useRepositoryStatus } from '@/lib/sync';
import {
  enqueueManualRepositoryRefresh,
  useManualRepositoryRefreshAvailable,
  useManualRepositoryRefreshPending,
} from '@/lib/sync/manual-refresh';
import { useTabController, useWindowState } from '@/lib/tabs/context';
import { UserPrefs } from '@/lib/user-prefs';
import { useCanvasCommandContext } from '@/pages/canvas/command-context';
import {
  importMarkdownFile,
  isMarkdownFile,
  MARKDOWN_FILE_ACCEPT,
} from '@/pages/library/import/markdown';
import {
  commandPalettePageFromTabTarget,
  commandPaletteShortcut,
  createCommandPaletteItems,
} from './items';
import { useCommandMode, useNotesMode } from './modes';
import type {
  CommandPaletteDialogProps,
  CommandPaletteItem,
  CommandPaletteMode,
} from './types';
import { errorDescription } from './utils';

const logger = new Logger('CommandPalette');

function pickMarkdownFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = MARKDOWN_FILE_ACCEPT;
    input.style.display = 'none';

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        resolve(file);
      },
      { once: true },
    );
    input.addEventListener(
      'cancel',
      () => {
        cleanup();
        resolve(null);
      },
      { once: true },
    );

    document.body.append(input);
    input.click();
  });
}

export function useCommandPalette(): {
  dialogProps: CommandPaletteDialogProps;
} {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const { getHandlers: getCanvasCommandHandlers } = useCanvasCommandContext();
  const tabController = useTabController();
  const windowState = useWindowState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CommandPaletteMode>('commands');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isImportingMarkdown, setIsImportingMarkdown] = useState(false);
  const isRefreshingRepository = useManualRepositoryRefreshPending();
  const [activeKeybindingActions, setActiveKeybindingActions] = useState<
    Action[]
  >(() => keybindings.getCommandPaletteActions());
  const focusedPane = tabController.getPane(windowState.focusedPaneId);
  const focusedTab = focusedPane
    ? (focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? null)
    : null;
  const currentPage = commandPalettePageFromTabTarget(
    focusedTab?.target ?? null,
  );
  const canRefreshRepository = useManualRepositoryRefreshAvailable(
    repositoryStatus.config,
    repositoryStatus.initializing,
  );

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  const openPalette = useCallback((nextMode: CommandPaletteMode) => {
    setActiveIndex(0);
    setMode(nextMode);
    setQuery('');
    setOpen(true);
  }, []);

  const handleQueryChange = useCallback((nextQuery: string) => {
    setActiveIndex(0);
    setQuery(nextQuery);
  }, []);

  useEffect(
    () =>
      keybindings.subscribe(() => {
        setActiveKeybindingActions(keybindings.getCommandPaletteActions());
      }),
    [],
  );

  const createNote = useCallback(async () => {
    closePalette();
    try {
      const name = await repository.getUniqueFileName(
        strings.library.createNew.untitledCanvas,
        null,
      );
      const id = await repository.createFile(name, 'mcanvas', null);
      tabController.openTab({ type: 'canvas', id }, name);
    } catch (error) {
      logger.error('Failed to create note from command palette', error);
      toast.error(strings.commandPalette.errors.createNote, {
        description: errorDescription(error),
      });
    }
  }, [
    closePalette,
    tabController,
    repository,
    strings.commandPalette.errors.createNote,
    strings.library.createNew.untitledCanvas,
  ]);

  const openGraph = useCallback(() => {
    closePalette();
    tabController.openTab({ type: 'graph' }, strings.graph.title);
  }, [closePalette, strings.graph.title, tabController]);

  const toggleLibraryView = useCallback(() => {
    closePalette();
    const current = UserPrefs.get('explorerViewMode');
    UserPrefs.set('explorerViewMode', current === 'tree' ? 'grid' : 'tree');
    if (focusedTab?.target.type !== 'library') {
      tabController.openTab({ type: 'library' }, 'Library');
    }
  }, [closePalette, focusedTab?.target.type, tabController]);

  const triggerLibraryMarkdownImport = useCallback(async () => {
    closePalette();
    const file = await pickMarkdownFile();
    if (!file || isImportingMarkdown) {
      return;
    }
    if (!isMarkdownFile(file)) {
      toast.error(strings.library.importMarkdown.unsupportedFile);
      return;
    }

    setIsImportingMarkdown(true);
    try {
      const id = await importMarkdownFile({
        file,
        repository,
        parentId: null,
        fallbackTitle: strings.library.createNew.untitledCanvas,
      });
      tabController.openTab({ type: 'canvas', id }, file.name);
    } catch (error) {
      toast.error(strings.library.importMarkdown.failed, {
        description: errorDescription(error),
      });
    } finally {
      setIsImportingMarkdown(false);
    }
  }, [
    closePalette,
    isImportingMarkdown,
    tabController,
    repository,
    strings.library.createNew.untitledCanvas,
    strings.library.importMarkdown.failed,
    strings.library.importMarkdown.unsupportedFile,
  ]);

  const triggerCanvasMarkdownImport = useCallback(async () => {
    closePalette();
    const file = await pickMarkdownFile();
    if (!file || isImportingMarkdown) {
      return;
    }
    if (!isMarkdownFile(file)) {
      toast.error(strings.library.importMarkdown.unsupportedFile);
      return;
    }

    const command = getCanvasCommandHandlers()?.importMarkdownFile;
    if (!command) {
      toast.error(strings.library.importMarkdown.failed);
      return;
    }

    setIsImportingMarkdown(true);
    try {
      await command(file);
    } catch (error) {
      toast.error(strings.library.importMarkdown.failed, {
        description: errorDescription(error),
      });
    } finally {
      setIsImportingMarkdown(false);
    }
  }, [
    closePalette,
    getCanvasCommandHandlers,
    isImportingMarkdown,
    strings.library.importMarkdown.failed,
    strings.library.importMarkdown.unsupportedFile,
  ]);

  const triggerKeybindingAction = useCallback(
    (action: Action) => {
      closePalette();
      keybindings.runAction(action);
    },
    [closePalette],
  );

  const refreshRepository = useCallback(() => {
    if (!canRefreshRepository || repositoryStatus.initializing) {
      return;
    }
    closePalette();

    enqueueManualRepositoryRefresh(async () => {
      try {
        await repository.refresh();
      } catch (error) {
        logger.error(
          'Failed to refresh repository from command palette',
          error,
        );
        toast.error(strings.commandPalette.errors.refreshRepository, {
          description: errorDescription(error),
        });
      }
    });
  }, [
    canRefreshRepository,
    closePalette,
    repository,
    repositoryStatus.initializing,
    strings.commandPalette.errors.refreshRepository,
  ]);

  const commandItems = useMemo(
    () =>
      createCommandPaletteItems({
        activeKeybindingActions,
        currentPage,
        strings,
        isImportingMarkdown,
        isRefreshingRepository,
        canRefreshRepository,
        createNote,
        openGraph,
        openPalette,
        refreshRepository,
        toggleLibraryView,
        triggerKeybindingAction,
        triggerCanvasMarkdownImport,
        triggerLibraryMarkdownImport,
      }),
    [
      activeKeybindingActions,
      canRefreshRepository,
      createNote,
      currentPage,
      isImportingMarkdown,
      isRefreshingRepository,
      openGraph,
      openPalette,
      refreshRepository,
      strings,
      toggleLibraryView,
      triggerCanvasMarkdownImport,
      triggerKeybindingAction,
      triggerLibraryMarkdownImport,
    ],
  );

  const shortcutBindings = useMemo<ActionBinding[]>(
    () => [
      {
        action: 'app:command-palette',
        allowEditable: true,
        onDown: (event) => {
          event.preventDefault();
          openPalette('commands');
        },
      },
    ],
    [openPalette],
  );
  useKeybindings(shortcutBindings);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commandMode = useCommandMode({ commandItems, query, strings });
  const notesMode = useNotesMode({
    active: open && mode === 'notes',
    closePalette,
    tabController,
    query,
    repository,
    strings,
  });
  const activeMode = mode === 'notes' ? notesMode : commandMode;
  const visibleItems = activeMode.items;

  useEffect(() => {
    if (activeIndex >= visibleItems.length) {
      setActiveIndex(Math.max(visibleItems.length - 1, 0));
    }
  }, [activeIndex, visibleItems.length]);

  const runItem = useCallback((item: CommandPaletteItem) => {
    if (item.disabled) {
      return;
    }
    void Promise.resolve(item.onSelect()).catch((error) => {
      logger.error('Command palette item failed', error, { id: item.id });
    });
  }, []);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) =>
        visibleItems.length === 0 ? 0 : (index + 1) % visibleItems.length,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) =>
        visibleItems.length === 0
          ? 0
          : (index - 1 + visibleItems.length) % visibleItems.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = visibleItems[activeIndex];
      if (item) {
        runItem(item);
      }
    }
  };

  return {
    dialogProps: {
      activeIndex,
      emptyMessage: activeMode.emptyMessage,
      footerShortcut: commandPaletteShortcut(),
      inputRef,
      items: visibleItems,
      loading: activeMode.loading,
      open,
      placeholder: activeMode.placeholder,
      query,
      onActiveIndexChange: setActiveIndex,
      onClose: closePalette,
      onInputKeyDown: handleInputKeyDown,
      onQueryChange: handleQueryChange,
      onRunItem: runItem,
    },
  };
}
