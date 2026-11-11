import { useCallback, useState } from 'react';
import { FileJson, FolderOutput } from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { trackEvent } from '@/lib/analytics';
import { pickFolder } from '@/lib/folder-picker';
import { useRepository } from '@/lib/sync';
import { exportObsidianVault } from '@/pages/library/export/obsidian-vault';
import { exportWorkspaceJson } from '@/pages/library/export/workspace-json';
import { ActionCard } from '../components/action-card';

const logger = new Logger('DataSection');

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DataSection() {
  const strings = useMessages();
  const repository = useRepository();
  const [exporting, setExporting] = useState<'obsidian' | 'json' | null>(null);
  const isExporting = exporting !== null;
  const dataStrings = strings.settings.dataExport;

  const handleExportObsidianVault = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const selected = await pickFolder().catch((error: unknown) => {
      logger.error('Failed to pick export folder', error);
      toast.error(dataStrings.export.failed, {
        description: errorDescription(error),
      });
      return null;
    });
    if (!selected) {
      return;
    }

    setExporting('obsidian');
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
      setExporting(null);
    }
  }, [isExporting, repository, dataStrings]);

  const handleExportWorkspaceJson = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const selected = await pickFolder().catch((error: unknown) => {
      logger.error('Failed to pick export folder', error);
      toast.error(dataStrings.exportJson.failed, {
        description: errorDescription(error),
      });
      return null;
    });
    if (!selected) {
      return;
    }

    setExporting('json');
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
      setExporting(null);
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
        <ActionCard
          icon={FolderOutput}
          label={dataStrings.export.label}
          description={dataStrings.export.description}
          action={dataStrings.export.button}
          onClick={() => void handleExportObsidianVault()}
          loading={exporting === 'obsidian'}
          disabled={isExporting}
        />
        <ActionCard
          icon={FileJson}
          label={dataStrings.exportJson.label}
          description={dataStrings.exportJson.description}
          action={dataStrings.exportJson.button}
          onClick={() => void handleExportWorkspaceJson()}
          loading={exporting === 'json'}
          disabled={isExporting}
        />
      </div>
    </section>
  );
}
