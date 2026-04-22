import { useState } from 'react';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';

interface RecentCardProps {
  nodeId: string;
  category: string;
  time: string;
  title: string;
  excerpt?: string;
  tags: string[];
  featured?: boolean;
  onClick?: () => void;
}

export function RecentCard({
  nodeId,
  category,
  time,
  title,
  excerpt,
  tags,
  featured,
  onClick,
}: RecentCardProps) {
  const thumbUrl = useThumbnailUrl(nodeId);
  const hasThumb = typeof thumbUrl === 'string';
  const [imgLoaded, setImgLoaded] = useState(false);

  const fadeMask = 'linear-gradient(to bottom, black 72%, transparent 100%)';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex aspect-[16/10] min-h-[180px] w-full cursor-pointer flex-col overflow-hidden rounded-xl text-left transition-all duration-300 hover:scale-[1.01] hover:shadow-ambient sm:aspect-auto sm:h-[204px]',
        featured ? 'bg-card-active hover:bg-card' : 'bg-surface hover:bg-card',
      )}
    >
      {/* Thumbnail region */}
      <div
        className="relative h-[56%] w-full overflow-hidden"
        style={{
          maskImage: fadeMask,
          WebkitMaskImage: fadeMask,
        }}
      >
        {hasThumb ? (
          <img
            src={thumbUrl}
            alt=""
            aria-hidden
            onLoad={() => setImgLoaded(true)}
            className={cn(
              'h-full w-full object-cover object-top transition-[opacity,transform] duration-500 ease-out group-hover:scale-[1.04]',
              imgLoaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(28, 39, 56, 0.12) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
              backgroundPosition: '0 0',
            }}
          />
        )}
      </div>

      {featured && (
        <div className="pointer-events-none absolute top-0 right-0 z-10">
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
          'absolute top-3 left-3 z-10 rounded-md px-2 py-1 font-normal text-[10px] uppercase tracking-[1px] backdrop-blur-sm sm:top-4 sm:left-4',
          featured
            ? 'bg-card-active/70 text-text-green'
            : 'bg-surface/70 text-text-secondary',
        )}
      >
        {category} &bull; {time}
      </span>

      <div className="relative flex flex-1 flex-col px-5 pt-4 pb-5 sm:px-6 sm:pb-6">
        <h4 className="font-heading font-normal text-text-primary text-xl leading-7 transition-colors duration-200 group-hover:text-accent-dark">
          {title}
        </h4>

        {excerpt && (
          <p className="mt-2 line-clamp-2 font-normal text-sm text-text-secondary leading-5">
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
      </div>
    </button>
  );
}
