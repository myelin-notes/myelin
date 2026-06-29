import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TagListProps {
  tags: string[];
  className: string;
  tagClassName: string;
  overflowClassName: string;
  max?: number;
}

export function TagList({
  tags,
  className,
  tagClassName,
  overflowClassName,
  max = 2,
}: TagListProps) {
  if (tags.length === 0) {
    return null;
  }

  const visible = tags.slice(0, max);
  const hidden = tags.slice(max);

  return (
    <div className={className}>
      {visible.map((tag) => (
        <span key={tag} className={tagClassName}>
          #{tag}
        </span>
      ))}
      {hidden.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={overflowClassName}>+{hidden.length}</span>
              }
            />
            <TooltipContent>
              {hidden.map((tag) => `#${tag}`).join(' ')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
