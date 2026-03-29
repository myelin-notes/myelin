interface StatusBarProps {
  zoomLevel: number;
  fps: number;
}

export function StatusBar({ zoomLevel, fps }: StatusBarProps) {
  return (
    <div className="absolute right-6 bottom-6 z-10 rounded-xl bg-white/80 px-4 py-3 shadow-ambient backdrop-blur-[24px]">
      <span className="font-medium text-text-secondary text-xs">
        {zoomLevel}%
      </span>
      <span className="mx-2 text-text-muted/30">|</span>
      <span className="font-medium text-text-muted text-xs">{fps} fps</span>
    </div>
  );
}
