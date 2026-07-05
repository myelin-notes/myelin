import { cn } from './utils';

interface WordmarkProps {
  className?: string;
}

function Wordmark({ className }: WordmarkProps) {
  return (
    <span
      className={cn(
        'font-heading font-semibold text-text-brand text-xl tracking-tight',
        className,
      )}
    >
      Myelin Notes
    </span>
  );
}

export { Wordmark };
