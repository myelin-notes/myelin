import { FileText } from 'lucide-react';
import { useMessages } from '@/lib/i18n';

/**
 * Shown in a pane that has no open tabs. Selecting a file in the sidebar opens
 * it here as a tab.
 */
export function EmptyEditor() {
  const strings = useMessages();
  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center gap-3 bg-page px-6 text-center">
      <FileText className="size-8 text-text-muted/50" strokeWidth={1.5} />
      <p className="max-w-xs text-sm text-text-muted">
        {strings.library.emptyState}
      </p>
    </div>
  );
}
