import { memo, type ReactNode } from 'react';

interface TitleBarProps {
  trailing?: ReactNode;
}

export const TitleBar = memo(function TitleBar({ trailing }: TitleBarProps) {
  if (!trailing) {
    return null;
  }

  return (
    <div className="fade-in-0 slide-in-from-top-2 absolute top-6 right-6 z-[100] flex animate-in items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border-subtle/70 duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]">
      {trailing}
    </div>
  );
});
