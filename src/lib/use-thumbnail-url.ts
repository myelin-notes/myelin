import { useEffect, useState } from 'react';
import type { FileId } from './sync';
import { getThumbnailUrl, subscribeThumbnail } from './thumbnails';

export function useThumbnailUrl(nodeId: FileId): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);

    const refresh = async () => {
      const next = await getThumbnailUrl(nodeId);
      if (!cancelled) {
        setUrl(next);
      }
    };

    void refresh();
    const unsubscribe = subscribeThumbnail(nodeId, () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [nodeId]);

  return url;
}
