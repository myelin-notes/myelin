import { Command } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMessages } from "@/lib/i18n";
import { CommandPaletteList } from "./list";
import type { CommandPaletteDialogProps } from "./types";

export function CommandPaletteDialog({
  activeIndex,
  emptyMessage,
  footerShortcut,
  inputRef,
  items,
  loading,
  open,
  placeholder,
  query,
  onActiveIndexChange,
  onClose,
  onInputKeyDown,
  onQueryChange,
  onRunItem,
}: CommandPaletteDialogProps) {
  const strings = useMessages();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-200 flex items-start justify-center bg-overlay-strong px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={strings.commandPalette.title}
            className="w-full max-w-2xl overflow-hidden rounded-[1.35rem] bg-popover/90 shadow-[0_24px_80px_rgb(var(--shadow-rgb)/0.16)] ring-1 ring-border-subtle backdrop-blur-md"
            initial={{ y: -12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="flex items-center gap-3 border-border-divider border-b px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-dark text-text-on-dark">
                <Command className="size-4" />
              </div>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent py-2 font-normal text-lg text-text-primary outline-none placeholder:text-text-muted"
              />
              <kbd className="hidden rounded-md border border-border-divider bg-surface px-2 py-1 font-semibold text-[10px] text-text-muted uppercase tracking-[0.08em] sm:inline">
                Esc
              </kbd>
            </div>

            <div className="p-2">
              {items.length > 0 ? (
                <CommandPaletteList
                  items={items}
                  activeIndex={activeIndex}
                  onActiveIndexChange={onActiveIndexChange}
                  onRunItem={onRunItem}
                />
              ) : (
                <div className="px-4 py-8 text-center text-sm text-text-muted">
                  {loading ? strings.commandPalette.loading : emptyMessage}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-border-divider border-t bg-surface/70 px-4 py-2 text-[11px] text-text-muted">
              <span>{strings.commandPalette.footer}</span>
              <span>{footerShortcut}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
