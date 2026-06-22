import { useCallback, useState } from 'react';
import { FolderOutput } from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { exportObsidianVault } from '@/pages/library/export/obsidian-vault';
import { exportWorkspaceJson } from '@/pages/library/export/workspace-json';

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
      trackEvent('export_completed', {
        format: 'obsidian_vault',
        notes_exported: result.notesExported,
        files_copied: result.filesCopied,
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

  const handleExportWorkspaceJson = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) {
      return;
    }

    setIsExporting(true);
    const toastId = toast.loading(dataStrings.exportJson.loading);
    try {
      const result = await exportWorkspaceJson({
        repository,
        destDir: selected,
        exportName: dataStrings.exportJson.defaultExportName,
        onProgress: ({ current, total }) => {
          toast.loading(dataStrings.exportJson.progress(current, total), {
            id: toastId,
          });
        },
      });
      trackEvent('export_completed', {
        format: 'workspace_json',
        notes_exported: result.notesExported,
        files_copied: result.filesCopied,
      });
      toast.success(
        dataStrings.exportJson.succeeded(
          result.notesExported,
          result.filesCopied,
        ),
        { id: toastId },
      );
    } catch (error) {
      logger.error('Failed to export workspace as JSON', error);
      toast.error(dataStrings.exportJson.failed, {
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
      <div className="flex flex-col gap-3">
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
        <div className="flex items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 ring-1 ring-border-subtle/70">
          <span className="min-w-0">
            <span className="block font-medium text-sm text-text-primary">
              {dataStrings.exportJson.label}
            </span>
            <span className="mt-1 block text-text-muted text-xs leading-relaxed">
              {dataStrings.exportJson.description}
            </span>
          </span>
          <Button
            onClick={() => void handleExportWorkspaceJson()}
            disabled={isExporting}
          >
            <FolderOutput className="size-3.5" />
            {dataStrings.exportJson.button}
          </Button>
        </div>
      </div>
    </section>
  );
}
