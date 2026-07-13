import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatRelativeTime } from '@myelin/editor/i18n/format';
import { errorDescription } from '@/components/command-palette/utils';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { useLocale, useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { createBlankCanvasFile } from '@/lib/note/create';
import { openNote } from '@/lib/note/navigation';
import {
  useRepository,
  useRepositoryStatus,
  type VFSFileNode,
} from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { RecentCard } from '@/pages/library/recent-card';

const logger = new Logger('HomePage');
const RECENT_FILE_LIMIT = 6;

export function HomePage() {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const tabController = useTabController();
  const scrollRef = useRef<HTMLElement | null>(null);
  const [recentFiles, setRecentFiles] = useState<VFSFileNode[]>([]);
  const recentFilesRequestRef = useRef(0);

  const loadRecentFiles = useCallback(async () => {
    const requestId = recentFilesRequestRef.current + 1;
    recentFilesRequestRef.current = requestId;

    try {
      const files = await repository.getRecentFiles(RECENT_FILE_LIMIT);
      if (requestId === recentFilesRequestRef.current) {
        setRecentFiles(files);
      }
    } catch (error) {
      if (requestId === recentFilesRequestRef.current) {
        logger.error('Failed to load recent files', error);
      }
    }
  }, [repository]);

  const createCanvas = useCallback(async () => {
    try {
      const name = await repository.getUniqueFileName(
        strings.library.createNew.untitledCanvas,
        null,
      );
      const id = await createBlankCanvasFile(repository, name, null);
      tabController.openTab({ type: 'canvas', id }, name);
      trackEvent('note_created', { file_type: 'mcanvas' });
    } catch (error) {
      logger.error('Failed to create canvas', error);
      toast.error(strings.commandPalette.errors.createNote, {
        description: errorDescription(error),
      });
    }
  }, [
    repository,
    strings.commandPalette.errors.createNote,
    strings.library.createNew.untitledCanvas,
    tabController,
  ]);

  // Load recents on mount, and reload when a remote sync lands or any local
  // repository mutation occurs (e.g. creating a file for a new tab).
  // `dataVersion` is the only refresh signal for local repos, where
  // `lastRemoteSyncAt` stays null.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    void loadRecentFiles();
  }, [
    loadRecentFiles,
    repositoryStatus.lastRemoteSyncAt,
    repositoryStatus.dataVersion,
  ]);

  return (
    <div className="relative flex h-full w-full bg-page">
      <a href="#home-main" data-skip-link className="skip-link">
        {strings.library.title}
      </a>

      <main
        ref={scrollRef}
        id="home-main"
        className="flex flex-1 flex-col overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:px-10 md:pt-12 lg:px-12"
      >
        {recentFiles.length === 0 ? (
          <div className="fade-in-0 slide-in-from-bottom-2 flex flex-1 animate-in flex-col items-center justify-center text-center duration-[250ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-surface ring-1 ring-border-subtle/70">
              <LayoutGrid className="size-7 text-text-muted" />
            </div>

            <h1
              className="mt-6 font-extralight font-heading text-text-primary leading-[1.05]"
              style={{ fontSize: 'var(--fluid-display)' }}
            >
              {strings.library.emptyState.title}
            </h1>

            <p className="mt-3 max-w-sm font-normal text-sm text-text-muted leading-relaxed">
              {strings.library.emptyState.description}
            </p>

            <Button
              size="lg"
              className="mt-7"
              onClick={() => void createCanvas()}
            >
              <Plus />
              {strings.library.emptyState.cta}
            </Button>
          </div>
        ) : (
          <div className="fade-in-0 slide-in-from-bottom-2 animate-in duration-[150ms] ease-out">
            <h1
              className="font-extralight font-heading text-text-primary leading-[1.05]"
              style={{ fontSize: 'var(--fluid-display)' }}
            >
              {strings.library.title}
            </h1>

            <section className="mt-12">
              <h2 className="mb-4 font-medium text-[11px] text-text-muted uppercase tracking-[1.5px]">
                {strings.library.recentlyOpened}
              </h2>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4">
                {recentFiles.map((file, i) => (
                  <div
                    key={file.id}
                    className="fade-in-0 slide-in-from-bottom-3 min-w-0 animate-in fill-mode-backwards duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <RecentCard
                      node={file}
                      category={
                        strings.library.fileTypes[
                          file.fileType as keyof typeof strings.library.fileTypes
                        ] ?? file.fileType
                      }
                      time={formatRelativeTime(file.modifiedAt, locale, {
                        style: 'short',
                      })}
                      onClick={() =>
                        openNote(tabController, file, file.name, 'recent_files')
                      }
                      onChanged={loadRecentFiles}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
