import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCopy } from '@/content/copy-context';
import type { SceneId } from '@/content/site';
import { cn } from '@/lib/utils';

interface SceneRailProps {
  scenes: ReadonlyArray<{ id: SceneId }>;
  index: number;
  onSelect: (index: number) => void;
}

/**
 * The visible half of the fake scroll: a fixed progress rail of scene dots
 * with prev/next steppers (the only navigation on touch devices, where the
 * canvas keeps single-finger pan for itself).
 */
export function SceneRail({ scenes, index, onSelect }: SceneRailProps) {
  const copy = useCopy();
  const rail = copy.canvas.rail;
  return (
    <nav
      aria-label={rail.label}
      className="fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col items-center gap-2 md:right-6"
    >
      <button
        type="button"
        aria-label={rail.previous}
        disabled={index === 0}
        onClick={() => onSelect(index - 1)}
        className="mb-1 flex size-8 cursor-pointer items-center justify-center rounded-full border border-neutral-300 bg-white/80 text-neutral-800 shadow-sm transition-opacity disabled:opacity-30"
      >
        <ChevronUp className="size-4" />
      </button>

      {scenes.map((scene, i) => (
        <button
          key={scene.id}
          type="button"
          aria-label={copy.sceneLabels[scene.id]}
          aria-current={i === index ? 'step' : undefined}
          title={copy.sceneLabels[scene.id]}
          onClick={() => onSelect(i)}
          className="group relative flex cursor-pointer items-center p-0.5"
        >
          <span className="pointer-events-none absolute right-6 hidden whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-white text-xs group-hover:block">
            {copy.sceneLabels[scene.id]}
          </span>
          <span
            className={cn(
              'block w-2.5 rounded-full transition-all duration-300',
              i === index
                ? 'h-7 bg-neutral-900'
                : 'h-2.5 bg-neutral-400/60 group-hover:bg-neutral-500',
            )}
          />
        </button>
      ))}

      <button
        type="button"
        aria-label={rail.next}
        disabled={index === scenes.length - 1}
        onClick={() => onSelect(index + 1)}
        className="mt-1 flex size-8 cursor-pointer items-center justify-center rounded-full border border-neutral-300 bg-white/80 text-neutral-800 shadow-sm transition-opacity disabled:opacity-30"
      >
        <ChevronDown className="size-4" />
      </button>
    </nav>
  );
}

/** "Scroll to explore" nudge shown until the visitor leaves the hero. */
export function ScrollHint({ visible }: { visible: boolean }) {
  const copy = useCopy();
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1 text-neutral-500 transition-opacity duration-500',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <span className="text-sm">{copy.canvas.rail.scrollHint}</span>
      <ChevronDown className="size-5 animate-bounce" />
    </div>
  );
}
