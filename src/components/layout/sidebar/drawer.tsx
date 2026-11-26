import { useEffect, useRef } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { usePresence } from '@myelin/ui';
import { useTabController, useWindowState } from '@/lib/tabs/context';
import { Sidebar } from '.';
import { useSidebar } from './context';

/**
 * Compact-layout sidebar: an overlay drawer that slides in over the content
 * with a dimmed backdrop, instead of the persistent desktop column. Closes on
 * backdrop tap, Escape, or navigation (so tapping a note reveals it rather than
 * leaving it hidden behind the drawer). Only rendered when the layout is
 * compact — see {@link RootLayout}.
 */
export function SidebarDrawer() {
  const { drawerOpen, close } = useSidebar();
  const strings = useMessages();
  const controller = useTabController();

  // Subscribe to window state so the active document is read fresh each change.
  useWindowState();
  const activeTabId = controller.getFocusedPane()?.activeTabId ?? null;
  const prevActiveTabId = useRef(activeTabId);
  useEffect(() => {
    if (prevActiveTabId.current !== activeTabId) {
      prevActiveTabId.current = activeTabId;
      close();
    }
  }, [activeTabId, close]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, close]);

  const presence = usePresence(drawerOpen);

  return (
    <>
      {/* Above canvas chrome (z-100..111), below in-canvas modals (z-200); body-portaled dialogs sit above RootLayout's isolate. */}
      {presence.mounted && (
        <button
          {...presence.state}
          type="button"
          aria-label={strings.sidebar.close}
          className="data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 z-[150] bg-black/40 fill-mode-forwards duration-150 data-closed:animate-out data-open:animate-in"
          onClick={close}
        />
      )}
      {/* Hidden rather than unmounted so folder/tag expansion and search survive reopening. */}
      <div
        {...presence.state}
        onAnimationEnd={presence.onAnimationEnd}
        className={cn(
          'data-closed:slide-out-to-left-full data-open:slide-in-from-left-full fixed inset-y-0 left-0 z-[150] w-[min(320px,85vw)] bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl duration-200 ease-out data-closed:animate-out data-open:animate-in',
          !presence.mounted && 'hidden',
        )}
      >
        <Sidebar fill />
      </div>
    </>
  );
}
