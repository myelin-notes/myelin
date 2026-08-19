import { useEffect, useState } from 'react';
import { Folder, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Folder name input. Committing creates a folder in the user's Drive, so the
 * value is committed on blur or Enter rather than on every keystroke.
 */
export function FolderField({
  value,
  disabled,
  resolving,
  onCommit,
  className,
}: {
  value: string;
  disabled: boolean;
  resolving: boolean;
  onCommit: (name: string) => void;
  className?: string;
}) {
  const strings = useMessages();
  const [draft, setDraft] = useState(value);

  // The committed name can change from elsewhere (a repository switch, or the
  // normalizer filling in the default), so follow it while not being edited.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Folder className="size-4 shrink-0 text-text-muted" />
      <Input
        value={draft}
        disabled={disabled}
        placeholder={strings.settings.repository.fields.folder.placeholder}
        aria-label={strings.settings.repository.fields.folder.label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
      {resolving && (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-text-muted" />
      )}
    </div>
  );
}
