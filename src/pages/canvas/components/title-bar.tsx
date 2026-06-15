import { memo, type ReactNode } from 'react';
import { motion } from 'motion/react';

interface TitleBarProps {
  trailing?: ReactNode;
}

export const TitleBar = memo(function TitleBar({ trailing }: TitleBarProps) {
  if (!trailing) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="absolute top-6 right-6 z-[100] flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border-subtle/70"
    >
      {trailing}
    </motion.div>
  );
});
