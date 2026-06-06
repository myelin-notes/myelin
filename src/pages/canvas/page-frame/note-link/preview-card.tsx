import { useState } from 'react';
import type { VFSNodeId } from '@/lib/sync';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';

const DOT_PLACEHOLDER_STYLE = {
  backgroundImage:
    'linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 48%), radial-gradient(circle, rgba(28, 39, 56, 0.12) 1px, transparent 1px)',
  backgroundPosition: '0 0, 0 0',
  backgroundSize: '100% 100%, 14px 14px',
};

const FADE_MASK = 'linear-gradient(to bottom, black 76%, transparent 100%)';

export interface NoteLinkPreviewCardProps {
  title: string;
  body: string | null;
  noteId: VFSNodeId | null;
}

export function NoteLinkPreviewCard({
  title,
  body,
  noteId,
}: NoteLinkPreviewCardProps) {
  return (
    <>
      <div className="px-4 pt-3.5 pb-3">
        <div className="truncate font-heading font-normal text-[17px] text-text-primary leading-6 tracking-[-0.005em]">
          {title}
        </div>
      </div>
      <ThumbnailRegion noteId={noteId} body={body} />
    </>
  );
}

function ThumbnailRegion({
  noteId,
  body,
}: {
  noteId: VFSNodeId | null;
  body: string | null;
}) {
  return (
    <div
      className="relative aspect-[16/10] w-full overflow-hidden bg-surface/80"
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
    >
      <div
        className="absolute inset-0 opacity-90"
        style={DOT_PLACEHOLDER_STYLE}
      />
      {noteId ? (
        <ThumbnailImage noteId={noteId} body={body} />
      ) : (
        <ExcerptOverlay body={body} />
      )}
    </div>
  );
}

function ThumbnailImage({
  noteId,
  body,
}: {
  noteId: VFSNodeId;
  body: string | null;
}) {
  const thumbUrl = useThumbnailUrl(noteId);
  const [imgLoaded, setImgLoaded] = useState(false);
  const hasThumb = typeof thumbUrl === 'string';

  if (!hasThumb) {
    return <ExcerptOverlay body={body} />;
  }

  return (
    <img
      src={thumbUrl}
      alt=""
      aria-hidden
      onLoad={() => setImgLoaded(true)}
      className={cn(
        'relative h-full w-full object-cover object-top transition-opacity duration-300 ease-out',
        imgLoaded ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}

function ExcerptOverlay({ body }: { body: string | null }) {
  if (!body) {
    return null;
  }
  return (
    <div className="absolute inset-0 flex items-start px-4 pt-3">
      <p className="line-clamp-5 whitespace-pre-wrap text-[12px] text-text-secondary leading-5">
        {body}
      </p>
    </div>
  );
}
