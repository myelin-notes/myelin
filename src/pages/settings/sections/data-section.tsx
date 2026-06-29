import { useCallback, useState } from 'react';
import {
  ArrowUpRight,
  FileJson,
  FolderOutput,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { cn } from '@/lib/utils';
import { exportObsidianVault } from '@/pages/library/export/obsidian-vault';
import { exportWorkspaceJson } from '@/pages/library/export/workspace-json';

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

    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) {
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

    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) {
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
        <ExportCard
          icon={FolderOutput}
          label={dataStrings.export.label}
          description={dataStrings.export.description}
          action={dataStrings.export.button}
          onClick={() => void handleExportObsidianVault()}
          loading={exporting === 'obsidian'}
          disabled={isExporting}
        />
        <ExportCard
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

function ExportCard({
  icon: Icon,
  label,
  description,
  action,
  onClick,
  loading,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  action: string;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
      className="group flex w-full items-center gap-4 rounded-xl bg-input/40 px-4 py-3.5 text-left ring-1 ring-border-subtle/70 transition-all duration-200 hover:bg-input hover:shadow-ambient hover:ring-text-muted/30 disabled:pointer-events-none disabled:opacity-60"
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg bg-text-brand/10 text-text-brand transition-colors duration-200',
          !disabled && 'group-hover:bg-text-brand/15',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-text-muted text-xs uppercase tracking-[0.08em] transition-colors duration-200 group-hover:text-text-brand">
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <>
            {action}
            <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </>
        )}
      </span>
    </button>
  );
}
