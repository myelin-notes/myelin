import { useCallback, useEffect, useState } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  ensureGoogleDriveFolder,
  type RepositoryConfig,
  renameGoogleDriveFolder,
  setRepositoryConfig,
} from '@/lib/sync';

const logger = new Logger('GoogleDriveFolder');

export interface GoogleDriveFolderState {
  /** True while the folder is being resolved or renamed in Drive. */
  resolving: boolean;
  error: string | null;
  setFolderName: (name: string) => void;
}

/**
 * Keeps `folderId` in step with `folderName`. Under the `drive.file` scope the
 * app cannot browse the user's existing folders, so there is nothing to pick
 * from: the folder is created on demand and found again by name. Resolving it
 * writes to Drive, so it runs only once a name is committed and the account is
 * connected. Once an id exists, a new name renames that folder rather than
 * resolving a different one.
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
      if (!config.folderId) {
        // Nothing resolved yet; the effect above finds or creates the folder.
        setRepositoryConfig({ ...config, folderName: next });
        return;
      }

      // Rename in place rather than resolving a new folder: the id keeps the
      // existing notes and the local cache, which is keyed on it.
      setResolving(true);
      setError(null);
      renameGoogleDriveFolder(config.credentialId, config.folderId, next)
        .then(() => {
          setRepositoryConfig({ ...config, folderName: next });
        })
        .catch((cause: unknown) => {
          logger.error('Failed to rename Google Drive folder', cause, {
            folderName: next,
          });
          setError(cause instanceof Error ? cause.message : resolveError);
        })
        .finally(() => {
          setResolving(false);
        });
    },
    [config, resolveError],
  );

  return { resolving, error, setFolderName };
}
