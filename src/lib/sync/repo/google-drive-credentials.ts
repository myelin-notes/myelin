import { appDataDir, join } from '@tauri-apps/api/path';
import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Stronghold,
  type Client as StrongholdClient,
  type Store as StrongholdStore,
} from '@tauri-apps/plugin-stronghold';
import { GOOGLE_CLIENT_ID } from '@/lib/env';
import { UserPrefs } from '@/lib/user-prefs';

const SECURE_STORAGE_UNAVAILABLE_ERROR =
  'Encrypted credential storage is unavailable on this device.';
const GOOGLE_DRIVE_STRONGHOLD_FILENAME = 'google-drive-credentials.hold';
const GOOGLE_DRIVE_STRONGHOLD_CLIENT = 'google-drive';

const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const GOOGLE_REFRESH_GRANT_TYPE = 'refresh_token';
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

interface StoredGoogleDriveCredentials {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  refreshToken: string;
  refreshTokenExpiresAtMs: number | null;
}

function getGoogleClientId(): string {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not configured.');
  }
  return GOOGLE_CLIENT_ID;
}

function normalizeCredentialId(credentialId?: string | null): string {
  const trimmed = typeof credentialId === 'string' ? credentialId.trim() : '';
  return trimmed || 'default';
}

function getGoogleDriveCredentialKey(credentialId: string): string {
  return `credentials:${normalizeCredentialId(credentialId)}`;
}

function generateGoogleDriveVaultPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function getGoogleDriveVaultPassword(): string {
  const existing = UserPrefs.get('googleDriveVaultPassword').trim();
  if (existing) {
    return existing;
  }

  const generated = generateGoogleDriveVaultPassword();
  UserPrefs.set('googleDriveVaultPassword', generated);
  return generated;
}

async function createGoogleDriveStrongholdStore(): Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> {
  const vaultPath = await join(
    await appDataDir(),
    GOOGLE_DRIVE_STRONGHOLD_FILENAME,
  );
  const stronghold = await Stronghold.load(
    vaultPath,
    getGoogleDriveVaultPassword(),
  );

  let client: StrongholdClient;
  try {
    client = await stronghold.loadClient(GOOGLE_DRIVE_STRONGHOLD_CLIENT);
  } catch {
    client = await stronghold.createClient(GOOGLE_DRIVE_STRONGHOLD_CLIENT);
  }

  return {
    stronghold,
    store: client.getStore(),
  };
}

let googleDriveStorePromise: Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> | null = null;

async function getGoogleDriveStrongholdStore(): Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> {
  if (!googleDriveStorePromise) {
    googleDriveStorePromise = createGoogleDriveStrongholdStore().catch(
      (error) => {
        googleDriveStorePromise = null;
        throw error;
      },
    );
  }

  return googleDriveStorePromise;
}

function storageUnavailableError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${SECURE_STORAGE_UNAVAILABLE_ERROR} ${message}`.trim());
}

async function withGoogleDriveStronghold<T>(
  run: (store: StrongholdStore, stronghold: Stronghold) => Promise<T>,
): Promise<T> {
  try {
    const { store, stronghold } = await getGoogleDriveStrongholdStore();
    return await run(store, stronghold);
  } catch (error) {
    throw storageUnavailableError(error);
  }
}

function decodeStoredCredentials(
  bytes: Uint8Array | null,
): StoredGoogleDriveCredentials | null {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<StoredGoogleDriveCredentials>;
    const refreshToken = String(parsed.refreshToken ?? '').trim();
    if (!refreshToken) {
      return null;
    }

    return {
      accessToken: String(parsed.accessToken ?? '').trim(),
      accessTokenExpiresAtMs: Number(parsed.accessTokenExpiresAtMs ?? 0),
      refreshToken,
      refreshTokenExpiresAtMs:
        parsed.refreshTokenExpiresAtMs == null
          ? null
          : Number(parsed.refreshTokenExpiresAtMs),
    };
  } catch {
    return null;
  }
}

async function readGoogleDriveCredentials(
  credentialId: string,
): Promise<StoredGoogleDriveCredentials | null> {
  return withGoogleDriveStronghold(async (store) => {
    const bytes = await store.get(getGoogleDriveCredentialKey(credentialId));
    return decodeStoredCredentials(bytes);
  });
}

async function storeGoogleDriveCredentialsRecord(
  credentialId: string,
  credentials: StoredGoogleDriveCredentials,
): Promise<void> {
  await withGoogleDriveStronghold(async (store, stronghold) => {
    const bytes = Array.from(
      new TextEncoder().encode(JSON.stringify(credentials)),
    );
    await store.insert(getGoogleDriveCredentialKey(credentialId), bytes);
    await stronghold.save();
  });
}

interface PendingDeviceAuthSession {
  deviceCode: string;
  intervalSeconds: number;
  expiresAtMs: number;
  nextPollAtMs: number;
}

const pendingDeviceAuthSessions = new Map<string, PendingDeviceAuthSession>();

interface GoogleDriveDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval?: number;
}

interface GoogleDriveTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface GoogleDriveDeviceAuthStartPayload {
  credentialId: string;
  userCode: string;
  verificationUrl: string;
  expiresAtMs: number;
  intervalSeconds: number;
}

export type GoogleDriveDeviceAuthPendingPayload = {
  status: 'pending';
  intervalSeconds: number;
  expiresAtMs: number;
  nextPollAtMs: number;
};

export type GoogleDriveDeviceAuthCompletePayload = {
  status: 'complete';
  credentialId: string;
};

export type GoogleDriveDeviceAuthFailedPayload = {
  status: 'failed';
  error: string;
};

export type GoogleDriveDeviceAuthPollResult =
  | GoogleDriveDeviceAuthPendingPayload
  | GoogleDriveDeviceAuthCompletePayload
  | GoogleDriveDeviceAuthFailedPayload;

function encodeFormBody(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

async function postGoogleDriveFormResponse<T>(
  url: string,
  entries: Record<string, string>,
): Promise<{
  status: number;
  ok: boolean;
  payload: T | null;
  bodyText: string;
}> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'myelin',
    },
    body: encodeFormBody(entries),
  });

  const bodyText = await response.text().catch(() => '<no response body>');
  let payload: T | null = null;
  try {
    payload = JSON.parse(bodyText) as T;
  } catch {
    payload = null;
  }

  return { status: response.status, ok: response.ok, payload, bodyText };
}

async function postGoogleDriveForm<T>(
  url: string,
  entries: Record<string, string>,
  label: string,
): Promise<T> {
  const response = await postGoogleDriveFormResponse<T>(url, entries);
  if (!response.ok || !response.payload) {
    throw new Error(`${label} (${response.status}): ${response.bodyText}`);
  }
  return response.payload;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deviceAuthFailureMessage(
  error: string,
  description: string | undefined,
): string {
  const trimmed = (description ?? '').trim();
  const detail = trimmed || 'Google Drive device authorization failed.';
  return `Google Drive device authorization failed: ${error} (${detail})`;
}

function isAccessTokenUsable(
  credentials: StoredGoogleDriveCredentials,
): boolean {
  return (
    credentials.accessToken.length > 0 &&
    credentials.accessTokenExpiresAtMs - ACCESS_TOKEN_REFRESH_BUFFER_MS >
      Date.now()
  );
}

export async function isGoogleDriveSecureStorageAvailable(): Promise<boolean> {
  try {
    await getGoogleDriveStrongholdStore();
    return true;
  } catch {
    return false;
  }
}

export async function getGoogleDriveAccessToken(
  credentialId: string,
): Promise<string> {
  const normalized = normalizeCredentialId(credentialId);
  const credentials = await readGoogleDriveCredentials(normalized);
  if (!credentials) {
    throw new Error('Google Drive credentials are not configured.');
  }

  if (isAccessTokenUsable(credentials)) {
    return credentials.accessToken;
  }

  const response = await postGoogleDriveForm<GoogleDriveTokenResponse>(
    GOOGLE_TOKEN_URL,
    {
      client_id: getGoogleClientId(),
      refresh_token: credentials.refreshToken,
      grant_type: GOOGLE_REFRESH_GRANT_TYPE,
    },
    'Google Drive access token refresh failed',
  );

  const accessToken = String(response.access_token ?? '').trim();
  if (!accessToken) {
    throw new Error(
      'Google Drive token refresh returned an empty access token.',
    );
  }

  const refreshed: StoredGoogleDriveCredentials = {
    accessToken,
    accessTokenExpiresAtMs:
      Date.now() + Number(response.expires_in ?? 3600) * 1000,
    refreshToken: credentials.refreshToken,
    refreshTokenExpiresAtMs:
      response.refresh_token_expires_in == null
        ? credentials.refreshTokenExpiresAtMs
        : Date.now() + response.refresh_token_expires_in * 1000,
  };
  await storeGoogleDriveCredentialsRecord(normalized, refreshed);
  return refreshed.accessToken;
}

export async function hasGoogleDriveCredentials(
  credentialId: string,
): Promise<boolean> {
  return Boolean(await readGoogleDriveCredentials(credentialId));
}

export async function clearGoogleDriveCredentials(
  credentialId: string,
): Promise<void> {
  await withGoogleDriveStronghold(async (store, stronghold) => {
    await store.remove(getGoogleDriveCredentialKey(credentialId));
    await stronghold.save();
  });
}

export async function isGoogleDriveDeviceAuthAvailable(): Promise<boolean> {
  try {
    getGoogleClientId();
  } catch {
    return false;
  }

  return isGoogleDriveSecureStorageAvailable();
}

export async function beginGoogleDriveDeviceAuth(
  credentialId: string,
): Promise<GoogleDriveDeviceAuthStartPayload> {
  const normalized = normalizeCredentialId(credentialId);
  const payload = await postGoogleDriveForm<GoogleDriveDeviceCodeResponse>(
    GOOGLE_DEVICE_CODE_URL,
    {
      client_id: getGoogleClientId(),
      scope: GOOGLE_DRIVE_OAUTH_SCOPE,
    },
    'Google Drive device auth request failed',
  );

  const intervalSeconds = payload.interval ?? 5;
  const expiresAtMs = Date.now() + payload.expires_in * 1000;
  pendingDeviceAuthSessions.set(normalized, {
    deviceCode: payload.device_code,
    intervalSeconds,
    expiresAtMs,
    nextPollAtMs: Date.now() + intervalSeconds * 1000,
  });

  return {
    credentialId: normalized,
    userCode: payload.user_code,
    verificationUrl: payload.verification_url,
    expiresAtMs,
    intervalSeconds,
  };
}

export async function openGoogleDriveDeviceAuth(
  payload: GoogleDriveDeviceAuthStartPayload,
): Promise<void> {
  await openUrl(payload.verificationUrl);
}

export async function startGoogleDriveDeviceAuth(
  credentialId: string,
): Promise<GoogleDriveDeviceAuthStartPayload> {
  const payload = await beginGoogleDriveDeviceAuth(credentialId);
  await openGoogleDriveDeviceAuth(payload);
  return payload;
}

export async function pollGoogleDriveDeviceAuth(
  credentialId: string,
): Promise<GoogleDriveDeviceAuthPollResult> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingDeviceAuthSessions.get(normalized);
  if (!session) {
    throw new Error('No active Google Drive device authorization session.');
  }

  const now = Date.now();
  if (now >= session.expiresAtMs) {
    pendingDeviceAuthSessions.delete(normalized);
    return {
      status: 'failed',
      error: 'Google Drive device authorization expired. Start sign-in again.',
    };
  }

  if (now < session.nextPollAtMs) {
    return {
      status: 'pending',
      intervalSeconds: session.intervalSeconds,
      expiresAtMs: session.expiresAtMs,
      nextPollAtMs: session.nextPollAtMs,
    };
  }

  const response = await postGoogleDriveFormResponse<GoogleDriveTokenResponse>(
    GOOGLE_TOKEN_URL,
    {
      client_id: getGoogleClientId(),
      device_code: session.deviceCode,
      grant_type: GOOGLE_DEVICE_GRANT_TYPE,
    },
  );

  if (response.ok && response.payload?.access_token) {
    const accessToken = response.payload.access_token.trim();
    const refreshToken = String(response.payload.refresh_token ?? '').trim();
    if (!accessToken || !refreshToken) {
      pendingDeviceAuthSessions.delete(normalized);
      return {
        status: 'failed',
        error:
          'Google Drive device authorization returned incomplete credentials.',
      };
    }

    await storeGoogleDriveCredentialsRecord(normalized, {
      accessToken,
      accessTokenExpiresAtMs:
        Date.now() + Number(response.payload.expires_in ?? 3600) * 1000,
      refreshToken,
      refreshTokenExpiresAtMs:
        response.payload.refresh_token_expires_in == null
          ? null
          : Date.now() + response.payload.refresh_token_expires_in * 1000,
    });
    pendingDeviceAuthSessions.delete(normalized);
    return { status: 'complete', credentialId: normalized };
  }

  const error = response.payload?.error ?? 'unknown_error';
  switch (error) {
    case 'authorization_pending': {
      const nextPollAtMs = Date.now() + session.intervalSeconds * 1000;
      session.nextPollAtMs = nextPollAtMs;
      return {
        status: 'pending',
        intervalSeconds: session.intervalSeconds,
        expiresAtMs: session.expiresAtMs,
        nextPollAtMs,
      };
    }
    case 'slow_down': {
      const intervalSeconds = session.intervalSeconds + 5;
      const nextPollAtMs = Date.now() + intervalSeconds * 1000;
      session.intervalSeconds = intervalSeconds;
      session.nextPollAtMs = nextPollAtMs;
      return {
        status: 'pending',
        intervalSeconds,
        expiresAtMs: session.expiresAtMs,
        nextPollAtMs,
      };
    }
    default:
      pendingDeviceAuthSessions.delete(normalized);
      return {
        status: 'failed',
        error: deviceAuthFailureMessage(
          error,
          response.payload?.error_description,
        ),
      };
  }
}

export async function cancelGoogleDriveDeviceAuth(
  credentialId: string,
): Promise<void> {
  pendingDeviceAuthSessions.delete(normalizeCredentialId(credentialId));
}

export async function waitForGoogleDriveDeviceAuth(
  credentialId: string,
  options?: {
    signal?: AbortSignal;
    onPending?: (result: GoogleDriveDeviceAuthPendingPayload) => void;
  },
): Promise<
  GoogleDriveDeviceAuthCompletePayload | GoogleDriveDeviceAuthFailedPayload
> {
  const normalized = normalizeCredentialId(credentialId);
  for (;;) {
    if (options?.signal?.aborted) {
      throw new Error('Google Drive device authorization wait aborted.');
    }

    const result = await pollGoogleDriveDeviceAuth(normalized);
    if (result.status !== 'pending') {
      return result;
    }

    options?.onPending?.(result);
    const delayMs = Math.max(250, result.nextPollAtMs - Date.now());
    await sleep(delayMs);
  }
}
