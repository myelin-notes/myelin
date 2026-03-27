import { ChevronLeft as ChevronLeftIcon } from "lucide-react";

interface TitleBarProps {
  fileName: string;
  onBack: () => void;
}

export function TitleBar({ fileName, onBack }: TitleBarProps) {
  return (
    <div className="absolute left-6 top-6 backdrop-blur-[24px] bg-white/80 rounded-xl shadow-ambient px-4 py-3 flex items-center gap-3 z-10">
      <button onClick={onBack} className="bg-transparent p-0 border-none cursor-pointer">
        <ChevronLeftIcon className="size-5 text-text-secondary hover:text-text-primary transition-colors" />
      </button>
      <h2 className="text-sm font-medium text-text-primary m-0 ml-1">{fileName}</h2>
      <span className="text-[10px] uppercase tracking-[0.05em] font-bold text-text-muted">Canvas</span>
    </div>
  );
}
