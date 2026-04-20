import { ChevronLeft as ChevronLeftIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useMessages } from '@/lib/i18n';

interface TitleBarProps {
  fileName: string;
  onBack: () => void;
}

export function TitleBar({ fileName, onBack }: TitleBarProps) {
  const strings = useMessages();

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="absolute top-6 left-6 z-10 flex max-w-[calc(100vw-3rem)] items-center gap-3 rounded-xl bg-white/80 px-4 py-3 shadow-ambient backdrop-blur-[24px]"
    >
      <button
        onClick={onBack}
        aria-label="Back"
        className="group shrink-0 cursor-pointer border-none bg-transparent p-0"
      >
        <ChevronLeftIcon className="size-5 text-text-secondary transition-all duration-200 group-hover:-translate-x-0.5 group-hover:text-text-primary" />
      </button>
      <h2 className="m-0 ml-1 truncate font-medium text-sm text-text-primary">
        {fileName}
      </h2>
      <span className="shrink-0 font-bold text-[10px] text-text-muted uppercase tracking-[0.05em]">
        {strings.canvas.kind}
      </span>
    </motion.div>
  );
}
