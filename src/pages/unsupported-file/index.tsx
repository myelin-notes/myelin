import { AlertCircle } from 'lucide-react';
import type { FileType } from '@/lib/sync';

interface UnsupportedFilePageProps {
  fileType: FileType;
}

export function UnsupportedFilePage({ fileType }: UnsupportedFilePageProps) {
  return (
    <main className="flex h-full items-center justify-center bg-page px-6 py-8">
      <div className="flex max-w-sm items-start gap-3 rounded-xl bg-surface px-4 py-3 text-text-secondary shadow-ambient">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-text-muted" />
        <div>
          <p className="m-0 font-medium text-sm text-text-primary">
            Preview unavailable
          </p>
          <p className="mt-1 mb-0 text-sm">
            {fileType.toUpperCase()} files can be stored here, but previewing
            them is not supported yet.
          </p>
        </div>
      </div>
    </main>
  );
}
