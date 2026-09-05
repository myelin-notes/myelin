import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { SETTINGS_SECTIONS } from './settings-sections';

interface SettingsRailProps {
  activeId: string | null;
  onJump: (id: string) => void;
}

export function SettingsRail({ activeId, onJump }: SettingsRailProps) {
  const strings = useMessages();
  return (
    <aside className="sticky top-12 hidden h-fit w-48 shrink-0 lg:block">
      <p className="mb-4 font-semibold text-[10px] text-text-muted uppercase tracking-widest">
        {strings.settings.title}
      </p>
      <nav aria-label={strings.settings.title} className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map((section) => {
          const isActive = activeId === section.id;
          const label = strings.settings[section.titleKey].title;
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onJump(section.id)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                '-mx-1 flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-left text-sm transition-colors',
                isActive
                  ? 'font-medium text-text-primary'
                  : 'font-normal text-text-muted hover:text-text-primary',
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
