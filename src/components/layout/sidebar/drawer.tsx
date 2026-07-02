import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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

  return (
    <AnimatePresence>
      {drawerOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close sidebar"
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={close}
          />
          <motion.div
            className="fixed inset-y-0 left-0 z-50 w-[min(320px,85vw)] shadow-xl"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
          >
            <Sidebar fill />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
