import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { cn } from '@/lib/utils';

/**
 * Frameless-window controls for Windows. The native title bar is disabled
 * (decorations: false), so the tab bar acts as the title bar and these buttons
 * replace the OS minimize/maximize/close — laid out flush to the top-right edge
 * like Discord. Only rendered on Windows, in the top-right pane.
 */
export function WindowControls() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void appWindow.isMaximized().then(setIsMaximized);
    };
    sync();
    void appWindow.onResized(sync).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [appWindow]);

  const handleMinimize = useCallback(() => {
    void appWindow.minimize();
  }, [appWindow]);

  const handleToggleMaximize = useCallback(() => {
    void appWindow.toggleMaximize();
  }, [appWindow]);

  const handleClose = useCallback(() => {
    void appWindow.close();
  }, [appWindow]);

  return (
    <div className="flex shrink-0 select-none self-stretch">
      <ControlButton onClick={handleMinimize} label="Minimize">
        <Minus className="size-3.5" />
      </ControlButton>
      <ControlButton
        onClick={handleToggleMaximize}
        label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </ControlButton>
      <ControlButton onClick={handleClose} label="Close" danger>
        <X className="size-3.5" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex w-[46px] cursor-pointer items-center justify-center text-text-muted transition-colors duration-150',
        danger
          ? 'hover:bg-red-600 hover:text-white'
          : 'hover:bg-hover-tint hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

// Windows-style glyphs kept as small inline squares; lucide's Square is heavier
// and Copy reads as a copy icon, neither matching the OS restore affordance.
function MaximizeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <rect
        x="0.75"
        y="0.75"
        width="9.5"
        height="9.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <rect
        x="0.75"
        y="2.75"
        width="7.5"
        height="7.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M2.75 2.25V1.75A1 1 0 0 1 3.75 0.75H9.25A1 1 0 0 1 10.25 1.75V7.25A1 1 0 0 1 9.25 8.25H8.75"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}
