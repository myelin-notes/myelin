interface StatusBarProps {
  zoomLevel: number;
  fps: number;
}

export function StatusBar({ zoomLevel, fps }: StatusBarProps) {
  return (
    <div className="absolute right-6 bottom-6 backdrop-blur-[24px] bg-white/80 rounded-xl shadow-ambient px-4 py-3 z-10">
      <span className="text-xs font-medium text-text-secondary">{zoomLevel}%</span>
      <span className="mx-2 text-text-muted/30">|</span>
      <span className="text-xs font-medium text-text-muted">{fps} fps</span>
    </div>
  );
}
