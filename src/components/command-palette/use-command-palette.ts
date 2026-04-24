import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useKeybindings } from '@/hooks/useKeybindings';
import { useMessages } from '@/lib/i18n';
import type { ActionBinding } from '@/lib/keybinds';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { UserPrefs } from '@/lib/user-prefs';
import {
  importMarkdownFile,
  isMarkdownFile,
} from '@/pages/library/import-markdown';
import { commandPaletteShortcut, createCommandPaletteItems } from './items';
import { useCommandMode, useNotesMode } from './modes';
import type {
  CommandPaletteDialogProps,
  CommandPaletteItem,
  CommandPaletteMode,
} from './types';
import { errorDescription } from './utils';

const logger = new Logger('CommandPalette');

export function useCommandPalette(): {
  dialogProps: CommandPaletteDialogProps;
  handleMarkdownInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  markdownInputRef: RefObject<HTMLInputElement | null>;
} {
  const strings = useMessages();
  const repository = useRepository();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CommandPaletteMode>('commands');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isImportingMarkdown, setIsImportingMarkdown] = useState(false);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  const openPalette = useCallback((nextMode: CommandPaletteMode) => {
    setMode(nextMode);
    setQuery('');
    setOpen(true);
  }, []);

  const createNote = useCallback(async () => {
    closePalette();
    try {
      const name = await repository.getUniqueFileName(
        strings.library.createNew.untitledCanvas,
        null,
      );
      const id = await repository.createFile(name, 'mcanvas', null);
      navigate(`/mcanvas/${id}`);
    } catch (error) {
      logger.error('Failed to create note from command palette', error);
      toast.error(strings.commandPalette.errors.createNote, {
        description: errorDescription(error),
      });
    }
  }, [
    closePalette,
    navigate,
    repository,
    strings.commandPalette.errors.createNote,
    strings.library.createNew.untitledCanvas,
  ]);

  const triggerMarkdownImport = useCallback(() => {
    closePalette();
    markdownInputRef.current?.click();
  }, [closePalette]);

  const toggleLibraryView = useCallback(() => {
    closePalette();
    const current = UserPrefs.get('explorerViewMode');
    UserPrefs.set('explorerViewMode', current === 'tree' ? 'grid' : 'tree');
    if (!location.pathname.startsWith('/library')) {
      navigate('/library');
    }
  }, [closePalette, location.pathname, navigate]);

  const handleMarkdownInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file || isImportingMarkdown) {
        return;
      }
      if (!isMarkdownFile(file)) {
        toast.error(strings.library.importMarkdown.unsupportedFile);
        return;
      }

      setIsImportingMarkdown(true);
      void importMarkdownFile({
        file,
        repository,
        parentId: null,
        fallbackTitle: strings.library.createNew.untitledCanvas,
      })
        .then((id) => navigate(`/mcanvas/${id}`))
        .catch((error) => {
          toast.error(strings.library.importMarkdown.failed, {
            description: errorDescription(error),
          });
        })
        .finally(() => setIsImportingMarkdown(false));
    },
    [
      isImportingMarkdown,
      navigate,
      repository,
      strings.library.createNew.untitledCanvas,
      strings.library.importMarkdown.failed,
      strings.library.importMarkdown.unsupportedFile,
    ],
  );

  const commandItems = useMemo(
    () =>
      createCommandPaletteItems({
        strings,
        isImportingMarkdown,
        createNote,
        openPalette,
        toggleLibraryView,
        triggerMarkdownImport,
      }),
    [
      createNote,
      isImportingMarkdown,
      openPalette,
      strings,
      toggleLibraryView,
      triggerMarkdownImport,
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

  useEffect(() => {
    setActiveIndex(0);
  }, [mode, open, query]);

  const commandMode = useCommandMode({ commandItems, query, strings });
  const notesMode = useNotesMode({
    active: open && mode === 'notes',
    closePalette,
    navigate,
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
    markdownInputRef,
    handleMarkdownInputChange,
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
      onQueryChange: setQuery,
      onRunItem: runItem,
    },
  };
}
