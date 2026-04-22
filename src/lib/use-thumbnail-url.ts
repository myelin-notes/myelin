import { useEffect, useState } from 'react';
import { ThumbnailCache } from './thumbnail-cache';

export function useThumbnailUrl(nodeId: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    (async () => {
      const has = await ThumbnailCache.exists(nodeId);
      if (cancelled) {
        return;
      }
      if (!has) {
        setUrl(null);
        return;
      }
      const resolved = await ThumbnailCache.getUrl(nodeId);
      if (cancelled) {
        return;
      }
      setUrl(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  return url;
}
