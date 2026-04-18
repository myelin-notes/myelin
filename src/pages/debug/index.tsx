import { useState } from 'react';
import { useStrings } from '@/lib/i18n';
import { PdfDocumentView } from '@/lib/pdf-renderer';

export function DebugPage() {
  const strings = useStrings();
  const [data, setData] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      setData(new Uint8Array(buf));
      setFileName(file.name);
    } catch (err) {
      console.error('[debug] read uploaded file failed', err);
    }
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex items-center gap-3 border-border border-b bg-surface px-4 py-3">
        <label className="cursor-pointer rounded-lg bg-primary px-3 py-2 font-medium text-sm text-white transition-colors hover:bg-primary/90">
          {strings.debug.uploadPdf}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFile(file);
              }
            }}
          />
        </label>
        {fileName && (
          <span className="text-sm text-text-secondary">{fileName}</span>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {data ? (
          <PdfDocumentView
            src={data}
            className="flex flex-col items-center gap-4 py-6"
            pageClassName="shadow-md"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            {strings.debug.empty}
          </div>
        )}
      </div>
    </div>
  );
}
