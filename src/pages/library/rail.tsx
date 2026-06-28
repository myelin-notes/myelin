import type { LucideIcon } from 'lucide-react';
import { Clock, Files, Tag } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { LibraryLens } from './types';

interface LibraryRailProps {
  lens: LibraryLens;
  onLensChange: (lens: LibraryLens) => void;
}

export function LibraryRail({ lens, onLensChange }: LibraryRailProps) {
  const strings = useMessages();

  const lenses: { id: LibraryLens; icon: LucideIcon; label: string }[] = [
    { id: 'files', icon: Files, label: strings.library.lens.files },
    { id: 'recent', icon: Clock, label: strings.library.lens.recent },
    { id: 'tags', icon: Tag, label: strings.library.lens.tags },
  ];

  return (
    <TooltipProvider>
      <nav
        aria-label={strings.library.title}
        className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-border-subtle/60 border-r bg-surface/40 px-1.5 py-4"
      >
        {lenses.map(({ id, icon, label }) => (
          <RailButton
            key={id}
            icon={icon}
            label={label}
            active={lens === id}
            onClick={() => onLensChange(id)}
          />
        ))}
      </nav>
    </TooltipProvider>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'group relative flex w-full cursor-pointer items-center justify-center rounded-md py-2.5 transition-colors',
          !active && 'hover:bg-card-active/30',
        )}
      >
        <span
          className={cn(
            'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent-dark transition-opacity',
            active ? 'opacity-100' : 'opacity-0',
          )}
        />
        <Icon
          className={cn(
            'size-4 shrink-0 transition-colors',
            active
              ? 'text-text-primary'
              : 'text-text-muted group-hover:text-text-secondary',
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
