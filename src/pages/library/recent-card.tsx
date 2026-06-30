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
  onClick?: () => void;
}

export function RecentCard({
  nodeId,
  category,
  time,
  title,
  excerpt,
  tags,
  onClick,
}: RecentCardProps) {
  const thumbUrl = useThumbnailUrl(nodeId);
  const hasThumb = typeof thumbUrl === 'string';
  const [loadedThumbUrl, setLoadedThumbUrl] = useState<string | null>(null);
  const imgLoaded = hasThumb && loadedThumbUrl === thumbUrl;

  const fadeMask = 'linear-gradient(to bottom, black 78%, transparent 100%)';
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
      className="group relative flex aspect-[16/11] min-h-[188px] w-full cursor-pointer flex-col overflow-hidden rounded-xl bg-surface text-left ring-1 ring-border-subtle/70 transition-all duration-300 hover:-translate-y-0.5 hover:bg-card hover:shadow-ambient sm:aspect-auto sm:h-[208px]"
    >
      {/* Thumbnail region */}
      <div
        className="relative h-[52%] w-full shrink-0 overflow-hidden bg-surface/80"
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

      <div className="relative flex flex-1 flex-col px-5 pt-3 pb-4 sm:px-5">
        <span className="font-normal text-[10px] text-text-muted uppercase tracking-[1px]">
          {category} &bull; {time}
        </span>

        <h4 className="mt-1 truncate font-heading font-normal text-lg text-text-primary leading-6 transition-colors duration-200 group-hover:text-text-brand dark:group-hover:text-text-on-dark">
          {title}
        </h4>

        {excerpt && (
          <p className="mt-1.5 line-clamp-2 font-normal text-sm text-text-secondary leading-5">
            {excerpt}
          </p>
        )}

        {tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-tag px-2 py-0.5 font-normal text-[10px] text-text-tag"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
