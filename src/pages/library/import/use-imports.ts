import { useCallback, useMemo, useRef, useState } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { trackEvent } from '@/lib/analytics';
import type { VFSNodeId } from '@/lib/sync';
import { useRepository } from '@/lib/sync';
import type { ImportJob, ImportSummaryData } from './dialog';
import {
  getImportProvider,
  type ImportProviderId,
  type ImportSelection,
} from './providers';

export interface ImportHostProps {
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onSelectProvider: (id: ImportProviderId) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  job: ImportJob | null;
  onImported: (summary: ImportSummaryData) => void;
  onCloseJob: () => void;
}

export interface Imports {
  importDisabled: boolean;
  openPicker: () => void;
  hostProps: ImportHostProps;
}

interface UseImportsOptions {
  /** Folder new imports land in. Null is the library root. */
  parentId: VFSNodeId | null;
  /** Called after a successful import so the tree can reload. */
  onChanged: () => void;
}

/**
 * Drives the whole import flow off the provider registry: picking a source,
 * collecting its input, and handing the resulting job to `ImportDialog`.
 * Adding a source needs no change here.
 */
export function useImports({
  parentId,
  onChanged,
}: UseImportsOptions): Imports {
  const repository = useRepository();
  const strings = useMessages();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingIdRef = useRef<ImportProviderId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [activeId, setActiveId] = useState<ImportProviderId | null>(null);

  const startJob = useCallback(
    (id: ImportProviderId, selection: ImportSelection) => {
      setActiveId(id);
      setJob(
        getImportProvider(id).createJob({
          selection,
          repository,
          parentId,
          strings,
        }),
      );
    },
    [parentId, repository, strings],
  );

  const onSelectProvider = useCallback(
    async (id: ImportProviderId) => {
      const provider = getImportProvider(id);

      if (provider.picker.kind === 'directory') {
        const selected = await openDialog({
          directory: true,
          multiple: false,
          recursive: true,
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }
        startJob(id, { kind: 'directory', path: selected });
        return;
      }

      if (provider.picker.kind === 'file') {
        const selected = await openDialog({
          multiple: false,
          filters: provider.picker.filters,
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }
        startJob(id, { kind: 'file', path: selected });
        return;
      }

      const input = fileInputRef.current;
      if (!input) {
        return;
      }
      // Set imperatively rather than through state: React has not flushed a
      // re-render by the time click() opens the dialog, so a state-driven
      // `accept` would still be the previous provider's.
      input.accept = provider.picker.accept;
      input.multiple = provider.picker.multiple;
      pendingIdRef.current = id;
      input.click();
    },
    [startJob],
  );

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      const id = pendingIdRef.current;
      pendingIdRef.current = null;
      if (files.length === 0 || id === null) {
        return;
      }
      startJob(id, { kind: 'files', files });
    },
    [startJob],
  );

  const onImported = useCallback(
    (summary: ImportSummaryData) => {
      onChanged();
      trackEvent('import_completed', {
        import_type: activeId,
        file_count: summary.stats?.count,
        partial_failure: (summary.stats?.skipped ?? 0) > 0,
      });
    },
    [onChanged, activeId],
  );

  const onCloseJob = useCallback(() => {
    setJob(null);
    setActiveId(null);
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);

  return {
    importDisabled: job !== null,
    openPicker,
    hostProps: useMemo(
      () => ({
        pickerOpen,
        onPickerOpenChange: setPickerOpen,
        onSelectProvider,
        fileInputRef,
        onFileInputChange,
        job,
        onImported,
        onCloseJob,
      }),
      [
        pickerOpen,
        onSelectProvider,
        onFileInputChange,
        job,
        onImported,
        onCloseJob,
      ],
    ),
  };
}
