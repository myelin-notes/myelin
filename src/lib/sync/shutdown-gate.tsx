import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { runShutdownTasks } from '@/lib/shutdown-tasks';
import { useRepository } from './repo-context';

const logger = new Logger('RepositoryShutdownGate');
const FORCE_QUIT_DELAY_MS = 10_000;

type ShutdownPhase = 'idle' | 'flushing';

interface ShutdownState {
  phase: ShutdownPhase;
  totalPending: number;
}

export function RepositoryShutdownGate() {
  const strings = useMessages();
  const copy = strings.shutdown;
  const repository = useRepository();
  const [shutdownState, setShutdownState] = useState<ShutdownState>({
    phase: 'idle',
    totalPending: 0,
  });
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [canForceQuit, setCanForceQuit] = useState(false);
  const shuttingDownRef = useRef(false);
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const register = async () => {
      try {
        const win = getCurrentWindow();
        const off = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          if (shuttingDownRef.current) {
            return;
          }
          shuttingDownRef.current = true;
          setIsShuttingDown(true);

          const totalPending =
            repositoryRef.current.getRuntimeStatus().pendingRemoteWrites;
          if (totalPending > 0) {
            setShutdownState({ phase: 'flushing', totalPending });
          }

          const shutdownResults = await runShutdownTasks();
          for (const result of shutdownResults) {
            if (result.status === 'rejected') {
              logger.error('Failed to run shutdown task', result.reason);
            }
          }

          try {
            await repositoryRef.current.dispose();
          } catch (error) {
            logger.error('Failed to dispose repository before quit', error);
          }

          try {
            await win.destroy();
          } catch (error) {
            logger.error('Failed to destroy window after flush', error);
          }
        });

        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      } catch (error) {
        logger.error('Failed to register close handler', error);
      }
    };

    void register();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isShuttingDown) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCanForceQuit(true);
    }, FORCE_QUIT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isShuttingDown]);

  const forceQuit = useCallback(() => {
    void getCurrentWindow()
      .destroy()
      .catch((error) => {
        logger.error('Failed to force-quit window', error);
      });
  }, []);

  if (!isShuttingDown) {
    return null;
  }

  return (
    <Dialog open modal>
      <DialogContent showCloseButton={false} className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between text-text-secondary text-xs">
          <div className="flex items-center gap-2.5">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            {shutdownState.phase === 'flushing'
              ? copy.progress(shutdownState.totalPending)
              : copy.title}
          </div>
          {canForceQuit && (
            <Tooltip>
              <TooltipTrigger
                onClick={forceQuit}
                className="fade-in-0 animate-in cursor-pointer text-text-tertiary underline decoration-border-ghost underline-offset-2 duration-200 hover:text-text-secondary"
              >
                {copy.forceQuit}
              </TooltipTrigger>
              <TooltipContent>{copy.forceQuitHint}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
