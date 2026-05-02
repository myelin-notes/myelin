import { Check } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';

type CanvasBg = 'grid' | 'dots' | 'blank';

function CanvasPreview({
  type,
  selected,
  onSelect,
}: {
  type: CanvasBg;
  selected: boolean;
  onSelect: () => void;
}) {
  const strings = useMessages();
  const labels: Record<CanvasBg, string> = strings.settings.canvasStyle.options;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          'relative aspect-video overflow-hidden rounded-xl p-4 transition-all duration-200',
          selected
            ? 'bg-card shadow-ambient ring-2 ring-accent-navy/20'
            : 'bg-input hover:bg-card hover:shadow-ambient',
        )}
      >
        {selected && (
          <div className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full bg-accent-navy">
            <Check className="size-2.5 text-text-on-dark" />
          </div>
        )}
        <div className="h-full w-full">
          {type === 'grid' && (
            <div
              className="h-full w-full opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(var(--accent-dark) 1px, transparent 1px), linear-gradient(90deg, var(--accent-dark) 1px, transparent 1px)',
                backgroundSize: '12px 12px',
              }}
            />
          )}
          {type === 'dots' && (
            <div
              className="h-full w-full opacity-30"
              style={{
                backgroundImage:
                  'radial-gradient(var(--accent-dark) 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            />
          )}
          {type === 'blank' && <div className="h-full w-full" />}
        </div>
      </div>
      <span
        className={cn(
          'mt-3 block text-center text-[10px] uppercase tracking-widest transition-colors',
          selected
            ? 'font-semibold text-accent-navy'
            : 'text-text-muted group-hover:text-text-primary',
        )}
      >
        {labels[type]}
      </span>
    </button>
  );
}

export function AppearanceSection() {
  const strings = useMessages();
  const canvasBg = useUserPref('canvasBackground');
  const handleCanvasBg = (bg: CanvasBg) => {
    UserPrefs.set('canvasBackground', bg);
  };

  return (
    <section id="appearance" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl">
          {strings.settings.canvasStyle.title}
        </h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.canvasStyle.eyebrow}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
        {(['grid', 'dots', 'blank'] as const).map((type) => (
          <CanvasPreview
            key={type}
            type={type}
            selected={canvasBg === type}
            onSelect={() => handleCanvasBg(type)}
          />
        ))}
      </div>
    </section>
  );
}
