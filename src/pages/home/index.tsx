import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
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

  useEffect(() => {
    void loadRecentFiles();
  }, [loadRecentFiles]);

  useEffect(() => {
    if (repositoryStatus.lastRemoteSyncAt !== null) {
      void loadRecentFiles();
    }
  }, [loadRecentFiles, repositoryStatus.lastRemoteSyncAt]);

  return (
    <div className="relative flex h-full w-full bg-page">
      <a href="#home-main" data-skip-link className="skip-link">
        {strings.library.title}
      </a>

      <main
        ref={scrollRef}
        id="home-main"
        className="flex-1 overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:px-10 md:pt-12 lg:px-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="mx-auto max-w-5xl"
        >
          <h1
            className="font-extralight font-heading text-text-primary leading-[1.05]"
            style={{ fontSize: 'var(--fluid-display)' }}
          >
            {strings.library.title}
          </h1>

          {recentFiles.length === 0 ? (
            <p className="mt-3 max-w-lg font-normal text-sm text-text-muted leading-relaxed">
              {strings.library.emptyState}
            </p>
          ) : (
            <section className="mt-10">
              <h3 className="mb-6 font-heading font-normal text-2xl text-text-primary leading-8">
                {strings.library.recentlyOpened}
              </h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recentFiles.map((file, i) => (
                  <motion.div
                    key={file.id}
                    className="min-w-0"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.4,
                      delay: i * 0.06,
                      ease: [0.25, 0.1, 0.25, 1],
                    }}
                  >
                    <RecentCard
                      nodeId={file.id}
                      category={
                        strings.library.fileTypes[
                          file.fileType as keyof typeof strings.library.fileTypes
                        ] ?? file.fileType
                      }
                      time={formatRelativeTime(file.modifiedAt, locale, {
                        style: 'short',
                      })}
                      title={file.name}
                      tags={file.tags}
                      featured={i === 0}
                      onClick={() =>
                        openNote(tabController, file, file.name, 'recent_files')
                      }
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          )}
        </motion.div>
      </main>
    </div>
  );
}
