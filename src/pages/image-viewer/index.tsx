import { useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import {
  getMimeTypeForFileType,
  isImageFileType,
  useRepository,
  type VFSFileNode,
  type VFSNodeId,
} from '@/lib/sync';

type ImageViewerState =
  | { status: 'loading' }
  | { status: 'ready'; file: VFSFileNode; url: string }
  | { status: 'error'; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ImageViewerPageProps {
  id: VFSNodeId;
}

export function ImageViewerPage({ id }: ImageViewerPageProps) {
  const repository = useRepository();
  const [state, setState] = useState<ImageViewerState>({ status: 'loading' });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadImage = async () => {
      setState({ status: 'loading' });
      setImageFailed(false);

      if (!id) {
        throw new Error('No image selected.');
      }

      const node = await repository.getNode(id);
      if (!node || node.type !== 'file' || !isImageFileType(node.fileType)) {
        throw new Error('This file is not an image.');
      }

      const bytes = await repository.readFileBytes(node.id);
      if (!bytes || bytes.byteLength === 0) {
        throw new Error('Image data is missing.');
      }

      const blob = new Blob([bytes as BlobPart], {
        type: getMimeTypeForFileType(node.fileType),
      });
      const nextObjectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(nextObjectUrl);
        return;
      }

      objectUrl = nextObjectUrl;
      setState({ status: 'ready', file: node, url: objectUrl });
    };

    loadImage().catch((error) => {
      if (!cancelled) {
        setState({ status: 'error', message: errorMessage(error) });
      }
    });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [id, repository]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-page">
      <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <LoaderCircle className="size-4 animate-spin" />
            Loading image
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex max-w-sm items-start gap-3 rounded-xl bg-surface px-4 py-3 text-text-secondary shadow-ambient">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-text-muted" />
            <div>
              <p className="m-0 font-medium text-sm text-text-primary">
                Could not open image
              </p>
              <p className="mt-1 mb-0 text-sm">{state.message}</p>
            </div>
          </div>
        )}

        {state.status === 'ready' && (
          <div className="relative flex h-full w-full items-center justify-center">
            <img
              src={state.url}
              alt={state.file.name}
              draggable={false}
              onError={() => setImageFailed(true)}
              className="max-h-full max-w-full rounded-lg object-contain shadow-elevated"
            />
            {imageFailed && (
              <div className="absolute bottom-0 rounded-xl bg-surface px-4 py-3 text-sm text-text-secondary shadow-ambient">
                This image format could not be displayed.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
