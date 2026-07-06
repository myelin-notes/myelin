interface ProgressRailProps {
  labels: string[];
  activeIndex: number;
  onJump: (index: number) => void;
}

/** Right-edge tour progress: one dot per canvas region. */
export function ProgressRail({ labels, activeIndex, onJump }: ProgressRailProps) {
  return (
    <nav
      aria-label="Tour progress"
      className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 flex-col items-end gap-3 md:flex"
    >
      {labels.map((label, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onJump(index)}
            aria-label={`Go to ${label}`}
            aria-current={isActive ? 'step' : undefined}
            className="group flex cursor-pointer items-center gap-2"
          >
            <span
              className={`text-xs transition-opacity ${
                isActive
                  ? 'text-text-primary opacity-100'
                  : 'text-text-muted opacity-0 group-hover:opacity-100'
              }`}
            >
              {label}
            </span>
            <span
              className={`rounded-full transition-all ${
                isActive
                  ? 'size-2.5 bg-accent-dark'
                  : 'size-2 bg-text-muted/40 group-hover:bg-text-muted'
              }`}
            />
          </button>
        );
      })}
    </nav>
  );
}
