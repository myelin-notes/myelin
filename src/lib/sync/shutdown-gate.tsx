import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository, useRepositoryStatus } from './context';

const logger = new Logger('RepositoryShutdownGate');

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
          if (shuttingDownRef.current) {
            return;
          }
          shuttingDownRef.current = true;
          event.preventDefault();

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
      </DialogContent>
    </Dialog>
  );
}
