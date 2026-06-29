import { useState } from 'react';
import type { VFSNodeId } from '@/lib/sync';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';
import { formatExplorerItemAccessibleName } from './accessibility-labels';

interface RecentCardProps {
  nodeId: VFSNodeId;
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
  const [loadedThumbUrl, setLoadedThumbUrl] = useState<string | null>(null);
  const imgLoaded = hasThumb && loadedThumbUrl === thumbUrl;

  const fadeMask = 'linear-gradient(to bottom, black 72%, transparent 100%)';
  const placeholderStyle = {
    backgroundImage: 'var(--gradient-thumb-placeholder)',
    backgroundPosition: '0 0, 0 0',
    backgroundSize: '100% 100%, 14px 14px',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        tags.length > 0
          ? formatExplorerItemAccessibleName(title, tags)
          : undefined
      }
      className={cn(
        'group relative flex aspect-[16/10] min-h-[180px] w-full cursor-pointer flex-col overflow-hidden rounded-xl text-left ring-1 ring-border-subtle/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-ambient sm:aspect-auto sm:h-[204px]',
        featured ? 'bg-card-active hover:bg-card' : 'bg-surface hover:bg-card',
      )}
    >
      {/* Thumbnail region */}
      <div
        className="relative h-[56%] w-full overflow-hidden bg-surface/80"
        style={{
          maskImage: fadeMask,
          WebkitMaskImage: fadeMask,
        }}
      >
        <div
          className={cn(
            'absolute inset-0 z-0 transition-opacity duration-300 ease-out',
            hasThumb && imgLoaded ? 'opacity-0' : 'opacity-90',
          )}
          style={placeholderStyle}
        />
        {hasThumb ? (
          <img
            src={thumbUrl}
            alt=""
            aria-hidden
            onLoad={() => setLoadedThumbUrl(thumbUrl)}
            className={cn(
              'relative z-10 h-full w-full bg-page object-cover object-top transition-opacity duration-500 ease-out',
              imgLoaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        ) : null}
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
        <h4 className="font-heading font-normal text-text-primary text-xl leading-7 transition-colors duration-200 group-hover:text-text-brand dark:group-hover:text-text-on-dark">
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
