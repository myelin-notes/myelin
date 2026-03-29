import { ChevronLeft as ChevronLeftIcon } from 'lucide-react';

interface TitleBarProps {
  fileName: string;
  onBack: () => void;
}

export function TitleBar({ fileName, onBack }: TitleBarProps) {
  return (
    <div className="absolute top-6 left-6 z-10 flex items-center gap-3 rounded-xl bg-white/80 px-4 py-3 shadow-ambient backdrop-blur-[24px]">
      <button
        onClick={onBack}
        className="cursor-pointer border-none bg-transparent p-0"
      >
        <ChevronLeftIcon className="size-5 text-text-secondary transition-colors hover:text-text-primary" />
      </button>
      <h2 className="m-0 ml-1 font-medium text-sm text-text-primary">
        {fileName}
      </h2>
      <span className="font-bold text-[10px] text-text-muted uppercase tracking-[0.05em]">
        Canvas
      </span>
    </div>
  );
}
