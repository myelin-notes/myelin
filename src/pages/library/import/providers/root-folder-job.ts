import type { Repository, VFSNodeId } from '@/lib/sync';
import type {
  ImportJob,
  ImportPreviewLine,
  ImportProgress,
  ImportSummaryData,
} from '../dialog';
import { resolveImportRootName } from '../import-tree';

interface RootFolderJobConfig<TScanned> {
  title: string;
  scanningLabel: string;
  emptyLabel: string;
  /** Display name of the folder this import creates under `parentId`. */
  rootName: string;
  repository: Repository;
  parentId: VFSNodeId | null;
  scan(): Promise<TScanned>;
  preview(scanned: TScanned): {
    lines: ImportPreviewLine[];
    skippedText: string | null;
    isEmpty: boolean;
  };
  /** `rootName` is the conflict-resolved name; create the root folder with it. */
  run(options: {
    scanned: TScanned;
    rootName: string;
    onProgress: (progress: ImportProgress) => void;
  }): Promise<ImportSummaryData>;
}

/**
 * Job skeleton for sources that land everything under one named root folder.
 * Handles the same-named-sibling lookup and applies the user's rename/replace
 * choice before `run` sees the name.
 */
export function createRootFolderImportJob<TScanned>(
  config: RootFolderJobConfig<TScanned>,
): ImportJob {
  let scanned: TScanned | null = null;
  let conflictNodeId: VFSNodeId | null = null;

  return {
    title: config.title,
    scanningLabel: config.scanningLabel,
    emptyLabel: config.emptyLabel,

    async scan() {
      scanned = await config.scan();

      const [folders] = await config.repository.listDirectory(config.parentId);
      conflictNodeId =
        folders.find(
          (folder) =>
            folder.name.toLowerCase() === config.rootName.toLowerCase(),
        )?.id ?? null;

      return {
        name: config.rootName,
        ...config.preview(scanned),
        conflict: conflictNodeId ? { nodeId: conflictNodeId } : null,
      };
    },

    async run({ conflictResolution, onProgress }) {
      if (scanned === null) {
        throw new Error('Must scan before importing');
      }

      const rootName = await resolveImportRootName({
        repository: config.repository,
        parentId: config.parentId,
        name: config.rootName,
        conflictNodeId,
        conflictResolution,
      });

      return config.run({ scanned, rootName, onProgress });
    },
  };
}
