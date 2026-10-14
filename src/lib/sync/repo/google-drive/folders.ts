import { fetch } from '@tauri-apps/plugin-http';
import { getGoogleDriveToken } from './credentials';
import { GoogleDriveRequestError } from './error';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
/** Parent id of My Drive's root. */
const DRIVE_ROOT_ID = 'root';
const ENTRY_FIELDS = 'files(id)';
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 60_000;
// Bound retry waits for interactive folder setup.
const MAX_TOTAL_RETRY_DELAY_MS = 60_000;

interface DriveFileResource {
  id: string;
}

interface DriveListResponse {
  files?: DriveFileResource[];
}

interface DriveContext {
  credentialId: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function readRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
  }
  return Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

interface DriveRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

// Auth headers are rebuilt per attempt so a token refreshed in the meantime is picked up.
async function driveRequest(
  ctx: DriveContext,
  label: string,
  url: string,
  init: DriveRequestInit,
): Promise<Response> {
  let sleptMs = 0;
  const startedAt = Date.now();
  const requestMetrics = {
    google_drive_stage: 'api_request' as const,
    google_drive_operation: label,
    google_drive_method: init.method,
    ...(init.body ? { google_drive_request_chars: init.body.length } : {}),
  };

  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    const accessToken = await getGoogleDriveToken(ctx.credentialId);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        body: init.body,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      throw new GoogleDriveRequestError(
        `${label} before receiving a response`,
        {
          ...requestMetrics,
          google_drive_duration_ms: Date.now() - startedAt,
          google_drive_attempts: attempt + 1,
        },
      );
    }

    if (response.ok) {
      return response;
    }
    const delayMs = readRetryDelayMs(response, attempt);
    if (
      !isRetryableStatus(response.status) ||
      attempt === MAX_REQUEST_ATTEMPTS - 1 ||
      sleptMs + delayMs > MAX_TOTAL_RETRY_DELAY_MS
    ) {
      const body = await response.text().catch(() => '<no response body>');
      let errorCode: string | undefined;
      try {
        const payload = JSON.parse(body) as {
          error?: { status?: string };
        };
        const code = payload.error?.status;
        if (code && /^[A-Z_]{1,64}$/.test(code)) {
          errorCode = code;
        }
      } catch {
        // Non-JSON error responses still retain their status and size below.
      }
      const requestId =
        response.headers?.get('x-goog-request-id') ??
        response.headers?.get('x-guploader-uploadid');
      const contentType = response.headers?.get('content-type');
      const retryAfter = response.headers?.get('retry-after');
      throw new GoogleDriveRequestError(`${label} (${response.status})`, {
        ...requestMetrics,
        google_drive_duration_ms: Date.now() - startedAt,
        google_drive_attempts: attempt + 1,
        google_drive_status: response.status,
        google_drive_response_chars: body.length,
        ...(errorCode ? { google_drive_error_code: errorCode } : {}),
        ...(contentType
          ? { google_drive_content_type: contentType.slice(0, 100) }
          : {}),
        ...(requestId
          ? { google_drive_request_id: requestId.slice(0, 100) }
          : {}),
        ...(retryAfter
          ? { google_drive_retry_after: retryAfter.slice(0, 100) }
          : {}),
      });
    }

    sleptMs += delayMs;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`${label}: exhausted retries.`);
}

async function findDriveEntry(
  ctx: DriveContext,
  parentId: string,
  name: string,
  mimeType?: string,
): Promise<DriveFileResource | null> {
  const clauses = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(name)}'`,
    'trashed = false',
  ];
  if (mimeType) {
    clauses.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
  }

  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(
    clauses.join(' and '),
  )}&fields=${encodeURIComponent(ENTRY_FIELDS)}&pageSize=1`;
  const response = await driveRequest(ctx, 'Google Drive lookup failed', url, {
    method: 'GET',
  });
  const payload = (await response.json()) as DriveListResponse;
  const file = payload.files?.[0];
  return file ?? null;
}

async function createDriveFile(
  ctx: DriveContext,
  parentId: string,
  name: string,
  mimeType?: string,
): Promise<string> {
  const response = await driveRequest(
    ctx,
    'Google Drive create failed',
    `${DRIVE_API_BASE}/files?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        parents: [parentId],
        ...(mimeType ? { mimeType } : {}),
      }),
    },
  );
  const payload = (await response.json()) as DriveFileResource;
  return payload.id;
}

// Creates it if this app has not created one by that name yet. Settings calls this to fill in
// `folderId` before the repository is used.
export async function ensureGoogleDriveFolder(
  credentialId: string,
  folderName: string,
): Promise<string> {
  const name = folderName.trim();
  if (!name) {
    throw new Error('Google Drive folder name cannot be empty.');
  }

  const ctx = { credentialId };
  const existing = await findDriveEntry(
    ctx,
    DRIVE_ROOT_ID,
    name,
    FOLDER_MIME_TYPE,
  );
  return (
    existing?.id ?? createDriveFile(ctx, DRIVE_ROOT_ID, name, FOLDER_MIME_TYPE)
  );
}

// Keeping the id keeps the notes inside it, and keeps the local cache, which is keyed on the id.
export async function renameGoogleDriveFolder(
  credentialId: string,
  folderId: string,
  folderName: string,
): Promise<void> {
  const name = folderName.trim();
  if (!name) {
    throw new Error('Google Drive folder name cannot be empty.');
  }

  await driveRequest(
    { credentialId },
    'Google Drive rename failed',
    `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
}
