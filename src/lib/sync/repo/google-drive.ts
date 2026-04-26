import { fetch } from '@tauri-apps/plugin-http';
import { BaseRepository } from './base';
import { getGoogleDriveAccessToken } from './google-drive-credentials';
import {
  createEmptyManifest,
  getNoteFileName,
  type VFSManifest,
} from './shared';
import type { RepositoryCapabilities } from './types';

interface GoogleDriveRepositoryConfig {
  credentialId: string;
}

interface GoogleDriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  headRevisionId?: string | null;
  trashed?: boolean;
}

interface GoogleDriveListResponse {
  files?: GoogleDriveFile[];
}

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_API_BASE =
  'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER_NAME = 'Myelin';
const ROOT_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const ROOT_FOLDER_PROPERTY_KEY = 'myelin_repository';
const ROOT_FOLDER_PROPERTY_VALUE = '1';
const FILE_ROLE_PROPERTY_KEY = 'myelin_role';
const FILE_ROLE_MANIFEST = 'manifest';
const FILE_ROLE_NOTE = 'note';
const NOTE_ID_PROPERTY_KEY = 'myelin_note_id';
const MAX_MANIFEST_RETRIES = 4;

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleDriveRepository extends BaseRepository {
  public readonly kind = 'googleDrive';
  public readonly capabilities: RepositoryCapabilities = {
    polling: true,
    liveSync: false,
  };

  private rootFolderIdPromise: Promise<string> | null = null;

  constructor(private readonly config: GoogleDriveRepositoryConfig) {
    super();
  }

  protected manifestMaxRetries(): number {
    return MAX_MANIFEST_RETRIES;
  }

  protected isConflictError(error: unknown): boolean {
    return String(error).includes('Google Drive revision conflict');
  }

  protected async loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    const manifestFile = await this.findManifestFile();
    if (!manifestFile) {
      return { manifest: createEmptyManifest(), revision: null };
    }

    const bytes = await this.getFileBytes(manifestFile.id);
    if (bytes.byteLength === 0) {
      return {
        manifest: createEmptyManifest(),
        revision: manifestFile.headRevisionId ?? null,
      };
    }

    return {
      manifest: JSON.parse(new TextDecoder().decode(bytes)) as VFSManifest,
      revision: manifestFile.headRevisionId ?? null,
    };
  }

  protected async saveManifestImpl(
    manifest: VFSManifest,
    revision: string | null,
    _action: string,
  ): Promise<string | null> {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    return this.saveFileBytes(
      await this.findManifestFile(),
      {
        name: 'manifest.json',
        mimeType: 'application/json',
        parents: [await this.ensureRootFolderId()],
        appProperties: {
          [FILE_ROLE_PROPERTY_KEY]: FILE_ROLE_MANIFEST,
        },
      },
      bytes,
      revision,
    );
  }

  protected async loadNoteBytes(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const noteFile = await this.findNoteFile(nodeId);
    if (!noteFile) {
      return { bytes: null, revision: null };
    }

    return {
      bytes: await this.getFileBytes(noteFile.id),
      revision: noteFile.headRevisionId ?? null,
    };
  }

  protected async saveNoteBytes(
    nodeId: string,
    bytes: Uint8Array,
    revision: string | null,
    _message: string,
  ): Promise<string | null> {
    return this.saveFileBytes(
      await this.findNoteFile(nodeId),
      {
        name: getNoteFileName(nodeId),
        mimeType: 'application/octet-stream',
        parents: [await this.ensureRootFolderId()],
        appProperties: {
          [FILE_ROLE_PROPERTY_KEY]: FILE_ROLE_NOTE,
          [NOTE_ID_PROPERTY_KEY]: nodeId,
        },
      },
      bytes,
      revision,
    );
  }

  protected async deleteNoteBytes(nodeId: string): Promise<void> {
    const noteFile = await this.findNoteFile(nodeId);
    if (!noteFile) {
      return;
    }

    await this.deleteFile(noteFile.id);
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${await getGoogleDriveAccessToken(this.config.credentialId)}`,
      'User-Agent': 'myelin',
    };
  }

  private async failureError(
    label: string,
    response: Response,
  ): Promise<Error> {
    const body = await response.text().catch(() => '<no response body>');
    return new Error(`${label} (${response.status}): ${body}`);
  }

  private async driveGetJson<T>(url: string, label: string): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.authHeaders(),
    });

    if (!response.ok) {
      throw await this.failureError(label, response);
    }

    return (await response.json()) as T;
  }

  private async getFileBytes(fileId: string): Promise<Uint8Array> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        method: 'GET',
        headers: await this.authHeaders(),
      },
    );

    if (!response.ok) {
      throw await this.failureError(
        'Google Drive content request failed',
        response,
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  private async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: await this.authHeaders(),
      },
    );

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw await this.failureError(
        'Google Drive delete request failed',
        response,
      );
    }
  }

  private async ensureRootFolderId(): Promise<string> {
    if (!this.rootFolderIdPromise) {
      this.rootFolderIdPromise = this.resolveRootFolderId().catch((error) => {
        this.rootFolderIdPromise = null;
        throw error;
      });
    }

    return this.rootFolderIdPromise;
  }

  private async resolveRootFolderId(): Promise<string> {
    const existing = await this.listFiles(
      [
        `mimeType = '${ROOT_FOLDER_MIME_TYPE}'`,
        'trashed = false',
        `appProperties has { key='${ROOT_FOLDER_PROPERTY_KEY}' and value='${ROOT_FOLDER_PROPERTY_VALUE}' }`,
      ].join(' and '),
    );
    if (existing[0]?.id) {
      return existing[0].id;
    }

    const created = await this.createMetadataOnlyFile({
      name: ROOT_FOLDER_NAME,
      mimeType: ROOT_FOLDER_MIME_TYPE,
      parents: ['root'],
      appProperties: {
        [ROOT_FOLDER_PROPERTY_KEY]: ROOT_FOLDER_PROPERTY_VALUE,
      },
    });
    return created.id;
  }

  private async listFiles(query: string): Promise<GoogleDriveFile[]> {
    const params = new URLSearchParams({
      q: query,
      spaces: 'drive',
      fields:
        'files(id,name,mimeType,parents,appProperties,headRevisionId,trashed)',
    });
    const payload = await this.driveGetJson<GoogleDriveListResponse>(
      `${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`,
      'Google Drive list request failed',
    );
    return payload.files ?? [];
  }

  private async createMetadataOnlyFile(metadata: {
    name: string;
    mimeType: string;
    parents: string[];
    appProperties: Record<string, string>;
  }): Promise<GoogleDriveFile> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files?fields=id,name,mimeType,parents,appProperties,headRevisionId,trashed`,
      {
        method: 'POST',
        headers: {
          ...(await this.authHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: metadata.name,
          mimeType: metadata.mimeType,
          parents: metadata.parents,
          appProperties: metadata.appProperties,
        }),
      },
    );

    if (!response.ok) {
      throw await this.failureError(
        'Google Drive create request failed',
        response,
      );
    }

    return (await response.json()) as GoogleDriveFile;
  }

  private async updateFileBytes(
    fileId: string,
    bytes: Uint8Array,
  ): Promise<GoogleDriveFile> {
    const response = await fetch(
      `${GOOGLE_DRIVE_UPLOAD_API_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,headRevisionId`,
      {
        method: 'PATCH',
        headers: {
          ...(await this.authHeaders()),
          'Content-Type': 'application/octet-stream',
        },
        body: bytes,
      },
    );

    if (!response.ok) {
      throw await this.failureError(
        'Google Drive upload request failed',
        response,
      );
    }

    return (await response.json()) as GoogleDriveFile;
  }

  private async saveFileBytes(
    existingFile: GoogleDriveFile | null,
    metadata: {
      name: string;
      mimeType: string;
      parents: string[];
      appProperties: Record<string, string>;
    },
    bytes: Uint8Array,
    revision: string | null,
  ): Promise<string | null> {
    let file = existingFile;
    if (file) {
      const latest = await this.getFileMetadata(file.id);
      const latestRevision = latest?.headRevisionId ?? null;
      if (latestRevision !== revision) {
        throw new Error('Google Drive revision conflict.');
      }
      file = latest;
    }

    if (!file) {
      if (revision !== null) {
        throw new Error('Google Drive revision conflict.');
      }
      file = await this.createMetadataOnlyFile(metadata);
    }

    const updated = await this.updateFileBytes(file.id, bytes);
    return updated.headRevisionId ?? null;
  }

  private async getFileMetadata(
    fileId: string,
  ): Promise<GoogleDriveFile | null> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,appProperties,headRevisionId,trashed`,
      {
        method: 'GET',
        headers: await this.authHeaders(),
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw await this.failureError(
        'Google Drive metadata request failed',
        response,
      );
    }

    return (await response.json()) as GoogleDriveFile;
  }

  private async findManifestFile(): Promise<GoogleDriveFile | null> {
    const rootFolderId = await this.ensureRootFolderId();
    return (
      (
        await this.listFiles(
          [
            'trashed = false',
            `'${escapeDriveQueryValue(rootFolderId)}' in parents`,
            `appProperties has { key='${FILE_ROLE_PROPERTY_KEY}' and value='${FILE_ROLE_MANIFEST}' }`,
          ].join(' and '),
        )
      )[0] ?? null
    );
  }

  private async findNoteFile(nodeId: string): Promise<GoogleDriveFile | null> {
    const rootFolderId = await this.ensureRootFolderId();
    return (
      (
        await this.listFiles(
          [
            'trashed = false',
            `'${escapeDriveQueryValue(rootFolderId)}' in parents`,
            `appProperties has { key='${NOTE_ID_PROPERTY_KEY}' and value='${escapeDriveQueryValue(nodeId)}' }`,
          ].join(' and '),
        )
      )[0] ?? null
    );
  }
}
