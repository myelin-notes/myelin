import { useState } from 'react';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import type { VFSFileNode } from '@/lib/sync';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';
import { formatExplorerItemAccessibleName } from './accessibility-labels';
import { useFileItemContextMenu } from './explorer/use-file-item-context-menu';

interface RecentCardProps {
  node: VFSFileNode;
  category: string;
  time: string;
  /** Emphasizes the card (used for the first, most-recent item). */
  featured?: boolean;
  onClick: () => void;
  onChanged: () => void;
}

export function RecentCard({
  node,
  category,
  time,
  featured,
  onClick,
  onChanged,
}: RecentCardProps) {
  const thumbUrl = useThumbnailUrl(node.id);
  const hasThumb = typeof thumbUrl === 'string';
  const [loadedThumbUrl, setLoadedThumbUrl] = useState<string | null>(null);
  const imgLoaded = hasThumb && loadedThumbUrl === thumbUrl;

  const { renaming, renameInputProps, menu, dialogs } = useFileItemContextMenu(
    node,
    onChanged,
  );

  const fadeMask = 'linear-gradient(to bottom, black 78%, transparent 100%)';
  const placeholderStyle = {
    backgroundImage: 'var(--gradient-thumb-placeholder)',
    backgroundPosition: '0 0, 0 0',
    backgroundSize: '100% 100%, 14px 14px',
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              onClick={() => {
                if (!renaming) {
                  onClick();
                }
              }}
              aria-label={
                renaming || node.tags.length === 0
                  ? undefined
                  : formatExplorerItemAccessibleName(node.name, node.tags)
              }
              className={cn(
                'group relative flex h-full min-h-[188px] w-full cursor-pointer flex-col overflow-hidden rounded-xl text-left ring-1 ring-border-subtle/70 transition-all duration-300 hover:-translate-y-0.5 hover:bg-card hover:shadow-ambient sm:min-h-[208px]',
                featured ? 'bg-card-active' : 'bg-surface',
              )}
            />
          }
        >
          {featured && (
            <div className="pointer-events-none absolute top-0 right-0 z-10">
              <svg
                width="44"
                height="44"
                viewBox="0 0 44 44"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M0 0H44V44L22 33L0 22V0Z"
                  className="fill-accent-green opacity-60"
                />
              </svg>
            </div>
          )}

          {/* Thumbnail region */}
          <div
            className="relative h-[108px] w-full shrink-0 overflow-hidden bg-surface/80"
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

            {renaming ? (
              <input
                {...renameInputProps}
                className="mt-1 min-w-0 border-primary border-b bg-transparent font-heading font-normal text-lg text-text-primary leading-6 outline-none"
              />
            ) : (
              <h4 className="mt-1 truncate font-heading font-normal text-lg text-text-primary leading-6 transition-colors duration-200 group-hover:text-text-brand dark:group-hover:text-text-on-dark">
                {node.name}
              </h4>
            )}

            {node.tags.length > 0 && (
              <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                {node.tags.map((tag) => (
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
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
      {dialogs}
    </>
  );
}
