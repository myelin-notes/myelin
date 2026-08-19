import { useCallback, useEffect, useState } from 'react';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  ensureGoogleDriveFolder,
  type RepositoryConfig,
  setRepositoryConfig,
} from '@/lib/sync';

const logger = new Logger('GoogleDriveFolder');

export interface GoogleDriveFolderState {
  /** True while the folder is being looked up or created in Drive. */
  resolving: boolean;
  error: string | null;
  setFolderName: (name: string) => void;
}

/**
 * Keeps `folderId` in step with `folderName`. Under the `drive.file` scope the
 * app cannot browse the user's existing folders, so there is nothing to pick
 * from: the folder is created on demand and found again by name. Resolving it
 * writes to Drive, so it runs only once a name is committed and the account is
 * connected.
 */
export function useGoogleDriveFolder({
  config,
  tokenPresent,
}: {
  config: RepositoryConfig;
  tokenPresent: boolean;
}): GoogleDriveFolderState {
  const strings = useMessages();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveError = strings.settings.repository.fields.folder.error;

  useEffect(() => {
    if (
      config.kind !== 'google-drive' ||
      !tokenPresent ||
      !config.folderName.trim() ||
      config.folderId
    ) {
      return;
    }

    let cancelled = false;
    setResolving(true);
    setError(null);

    ensureGoogleDriveFolder(config.credentialId, config.folderName)
      .then((folderId) => {
        if (!cancelled) {
          setRepositoryConfig({ ...config, folderId });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        logger.error('Failed to resolve Google Drive folder', cause, {
          folderName: config.folderName,
        });
        setError(cause instanceof Error ? cause.message : resolveError);
      })
      .finally(() => {
        if (!cancelled) {
          setResolving(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config, tokenPresent, resolveError]);

  const setFolderName = useCallback(
    (name: string) => {
      if (config.kind !== 'google-drive') {
        return;
      }
      const next = name.trim() || DEFAULT_GOOGLE_DRIVE_FOLDER_NAME;
      if (next === config.folderName) {
        return;
      }
      // Clearing the id makes the effect above resolve the renamed folder.
      setRepositoryConfig({ ...config, folderName: next, folderId: '' });
    },
    [config],
  );

  return { resolving, error, setFolderName };
}
