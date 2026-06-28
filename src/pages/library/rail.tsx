import type { LucideIcon } from 'lucide-react';
import { Clock, Files, Network, Settings, Tag } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMessages } from '@/lib/i18n';
import { TAB_BAR_HEIGHT_CLASS } from '@/lib/platform';
import { useTabController } from '@/lib/tabs/context';
import { cn } from '@/lib/utils';
import type { LibraryLens } from './types';

interface LibraryRailProps {
  lens: LibraryLens;
  onLensChange: (lens: LibraryLens) => void;
}

export function LibraryRail({ lens, onLensChange }: LibraryRailProps) {
  const strings = useMessages();
  const controller = useTabController();

  const lenses: { id: LibraryLens; icon: LucideIcon; label: string }[] = [
    { id: 'files', icon: Files, label: strings.library.lens.files },
    { id: 'recent', icon: Clock, label: strings.library.lens.recent },
    { id: 'tags', icon: Tag, label: strings.library.lens.tags },
  ];

  return (
    <TooltipProvider>
      <nav
        aria-label={strings.library.title}
        className="flex w-12 shrink-0 flex-col items-center border-border-subtle/60 border-r bg-surface/40 px-1.5 pb-4"
      >
        {/* Drag strip that also clears the macOS traffic lights overlaid on the
            window's top-left corner, which the rail now occupies. */}
        <div
          data-tauri-drag-region
          className={cn('w-full shrink-0', TAB_BAR_HEIGHT_CLASS)}
        />

        <div className="flex flex-col items-center gap-0.5 pt-1">
          {lenses.map(({ id, icon, label }) => (
            <RailButton
              key={id}
              icon={icon}
              label={label}
              active={lens === id}
              onClick={() => onLensChange(id)}
            />
          ))}
        </div>

        <div className="mt-auto flex flex-col items-center gap-0.5">
          <RailButton
            icon={Network}
            label={strings.graph.title}
            active={false}
            onClick={() =>
              controller.openTab({ type: 'graph' }, strings.graph.title)
            }
          />
          <RailButton
            icon={Settings}
            label={strings.tabBar.settings}
            active={false}
            onClick={() =>
              controller.openTab({ type: 'settings' }, strings.tabBar.settings)
            }
          />
        </div>
      </nav>
    </TooltipProvider>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
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
          className,
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
