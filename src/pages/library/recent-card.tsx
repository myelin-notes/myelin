import { cn } from '@/lib/utils';

interface RecentCardProps {
  category: string;
  time: string;
  title: string;
  excerpt?: string;
  tags: string[];
  featured?: boolean;
  onClick?: () => void;
}

export function RecentCard({
  category,
  time,
  title,
  excerpt,
  tags,
  featured,
  onClick,
}: RecentCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex h-[204px] w-full cursor-pointer flex-col overflow-hidden rounded-xl p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:bg-card hover:shadow-ambient',
        featured ? 'bg-card-active' : 'bg-surface',
      )}
    >
      {featured && (
        <div className="absolute top-0 right-0">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            <path
              d="M0 0H44V44L22 33L0 22V0Z"
              className="fill-accent-green opacity-60"
            />
          </svg>
        </div>
      )}

      <span
        className={cn(
          'font-normal text-[10px] uppercase tracking-[1px]',
          featured ? 'text-text-green' : 'text-text-secondary',
        )}
      >
        {category} &bull; {time}
      </span>

      <h4 className="mt-4 font-heading font-normal text-text-primary text-xl leading-7 transition-colors duration-200 group-hover:text-accent-dark">
        {title}
      </h4>

      {excerpt && (
        <p className="mt-4 line-clamp-2 font-normal text-sm text-text-secondary leading-5">
          {excerpt}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-tag px-2 py-0.5 font-normal text-[10px] text-text-tag"
          >
            #{tag}
          </span>
        ))}
      </div>
    </button>
  );
}
