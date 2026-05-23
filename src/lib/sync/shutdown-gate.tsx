import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository, useRepositoryStatus } from './context';

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
  const status = useRepositoryStatus();
  const [shutdownState, setShutdownState] = useState<ShutdownState>({
    phase: 'idle',
    totalPending: 0,
  });
  const [canForceQuit, setCanForceQuit] = useState(false);
  const shuttingDownRef = useRef(false);
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
  const initialPendingRef = useRef(status.pendingRemoteWrites);
  initialPendingRef.current = status.pendingRemoteWrites;

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

          const totalPending = initialPendingRef.current;
          if (totalPending > 0) {
            setShutdownState({ phase: 'flushing', totalPending });
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
    if (shutdownState.phase !== 'flushing') {
      return;
    }
    const timer = window.setTimeout(() => {
      setCanForceQuit(true);
    }, FORCE_QUIT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [shutdownState.phase]);

  const forceQuit = useCallback(() => {
    void getCurrentWindow()
      .destroy()
      .catch((error) => {
        logger.error('Failed to force-quit window', error);
      });
  }, []);

  if (shutdownState.phase !== 'flushing') {
    return null;
  }

  const remaining = status.pendingRemoteWrites;
  const total = shutdownState.totalPending;
  const completed = Math.min(total, Math.max(0, total - remaining));
  const ratio = total === 0 ? 1 : completed / total;
  const percent = Math.round(ratio * 100);

  return (
    <Dialog open modal>
      <DialogContent showCloseButton={false} className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="text-text-secondary text-xs">
            {copy.progress(remaining, total)}
          </div>
        </div>
        {canForceQuit && (
          <DialogFooter>
            <div className="flex flex-col gap-1 sm:items-end">
              <Button variant="outline" onClick={forceQuit}>
                {copy.forceQuit}
              </Button>
              <div className="text-text-secondary text-xs">
                {copy.forceQuitHint}
              </div>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
