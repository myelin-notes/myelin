import { useCallback, useState } from 'react';
import { FolderOutput } from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { exportObsidianVault } from '@/pages/library/export/obsidian-vault';

const logger = new Logger('DataSection');

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DataSection() {
  const strings = useMessages();
  const repository = useRepository();
  const [isExporting, setIsExporting] = useState(false);
  const dataStrings = strings.settings.dataExport;

  const handleExportObsidianVault = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) {
      return;
    }

    setIsExporting(true);
    const toastId = toast.loading(dataStrings.export.loading);
    try {
      const result = await exportObsidianVault({
        repository,
        destDir: selected,
        vaultName: dataStrings.export.defaultVaultName,
        onProgress: ({ current, total }) => {
          toast.loading(dataStrings.export.progress(current, total), {
            id: toastId,
          });
        },
      });
      toast.success(
        dataStrings.export.succeeded(result.notesExported, result.filesCopied),
        { id: toastId },
      );
    } catch (error) {
      logger.error('Failed to export Obsidian vault', error);
      toast.error(dataStrings.export.failed, {
        id: toastId,
        description: errorDescription(error),
      });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, repository, dataStrings]);

  return (
    <section id="data" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">{dataStrings.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {dataStrings.eyebrow}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 ring-1 ring-border-subtle/70">
        <span className="min-w-0">
          <span className="block font-medium text-sm text-text-primary">
            {dataStrings.export.label}
          </span>
          <span className="mt-1 block text-text-muted text-xs leading-relaxed">
            {dataStrings.export.description}
          </span>
        </span>
        <Button
          onClick={() => void handleExportObsidianVault()}
          disabled={isExporting}
        >
          <FolderOutput className="size-3.5" />
          {dataStrings.export.button}
        </Button>
      </div>
    </section>
  );
}
