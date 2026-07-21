import { join } from '@tauri-apps/api/path';
import { remove } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Stronghold,
  type Client as StrongholdClient,
  type Store as StrongholdStore,
} from '@tauri-apps/plugin-stronghold';
import { GITHUB_CLIENT_ID } from '@/lib/env';
import { Logger } from '@/lib/logger';
import { UserPrefs } from '@/lib/user-prefs';
import { getAppDataDir } from '@/platform/tauri/fs-cache';

const logger = new Logger('GitHubCredentials');

const SECURE_STORAGE_UNAVAILABLE_ERROR =
  'Encrypted credential storage is unavailable on this device.';
const GITHUB_STRONGHOLD_FILENAME = 'github-credentials.hold';
const GITHUB_STRONGHOLD_CLIENT = 'github';

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_OAUTH_SCOPE = 'repo';
const GITHUB_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

function getGitHubClientId(): string {
  if (!GITHUB_CLIENT_ID) {
    throw new Error('VITE_GITHUB_CLIENT_ID is not configured.');
  }
  return GITHUB_CLIENT_ID;
}

function normalizeCredentialId(credentialId?: string | null): string {
  const trimmed = typeof credentialId === 'string' ? credentialId.trim() : '';
  return trimmed || 'default';
}

function getGitHubTokenKey(credentialId: string): string {
  return `token:${normalizeCredentialId(credentialId)}`;
}

function generateGitHubVaultPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function getGitHubVaultPassword(): string {
  const existing = UserPrefs.get('githubVaultPassword').trim();
  if (existing) {
    return existing;
  }

  const generated = generateGitHubVaultPassword();
  UserPrefs.set('githubVaultPassword', generated);
  return generated;
}

function isVaultKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('BadFileKey') || message.includes('decode/decrypt');
}

// Set when a stale, undecryptable vault is discarded so the UI can surface a
// one-time "sign-in expired, please reconnect" notice. Read-and-cleared via
// consumeGitHubVaultDiscarded().
let githubVaultDiscarded = false;

export function consumeGitHubVaultDiscarded(): boolean {
  const discarded = githubVaultDiscarded;
  githubVaultDiscarded = false;
  return discarded;
}

async function loadGitHubStronghold(
  vaultPath: string,
  password: string,
): Promise<Stronghold> {
  try {
    return await Stronghold.load(vaultPath, password);
  } catch (error) {
    if (!isVaultKeyError(error)) {
      throw error;
    }

    // The vault file exists but can't be decrypted with the current password
    // (e.g. the stored vault password was reset/regenerated). Any token inside
    // is unrecoverable, so discard the file and start fresh — the user simply
    // re-authenticates. Logged as a warning so it isn't reported as an
    // exception for an expected, self-healing condition.
    logger.warn('Discarding unreadable GitHub credential vault', error);
    githubVaultDiscarded = true;
    await remove(vaultPath).catch((removeError) => {
      logger.warn('Failed to remove unreadable GitHub vault', removeError);
    });
    return Stronghold.load(vaultPath, password);
  }
}

async function createGitHubStrongholdStore(): Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> {
  const vaultPath = await join(
    await getAppDataDir(),
    GITHUB_STRONGHOLD_FILENAME,
  );
  const stronghold = await loadGitHubStronghold(
    vaultPath,
    getGitHubVaultPassword(),
  );

  let client: StrongholdClient;
  try {
    client = await stronghold.loadClient(GITHUB_STRONGHOLD_CLIENT);
  } catch {
    client = await stronghold.createClient(GITHUB_STRONGHOLD_CLIENT);
  }

  return {
    stronghold,
    store: client.getStore(),
  };
}

let githubStorePromise: Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> | null = null;

async function getGitHubStrongholdStore(): Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> {
  if (!githubStorePromise) {
    githubStorePromise = createGitHubStrongholdStore().catch((error) => {
      githubStorePromise = null;
      throw error;
    });
  }

  return githubStorePromise;
}

function storageUnavailableError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${SECURE_STORAGE_UNAVAILABLE_ERROR} ${message}`.trim());
}

async function withGitHubStronghold<T>(
  run: (store: StrongholdStore, stronghold: Stronghold) => Promise<T>,
): Promise<T> {
  try {
    const { store, stronghold } = await getGitHubStrongholdStore();
    return await run(store, stronghold);
  } catch (error) {
    throw storageUnavailableError(error);
  }
}

function decodeGitHubToken(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  const token = new TextDecoder().decode(bytes).trim();
  return token || null;
}

async function readGitHubToken(credentialId: string): Promise<string | null> {
  return withGitHubStronghold(async (store) => {
    const bytes = await store.get(getGitHubTokenKey(credentialId));
    return decodeGitHubToken(bytes);
  });
}

interface PendingDeviceAuthSession {
  deviceCode: string;
  intervalSeconds: number;
  expiresAtMs: number;
  nextPollAtMs: number;
}

const pendingDeviceAuthSessions = new Map<string, PendingDeviceAuthSession>();

interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string | null;
  expires_in: number;
  interval?: number;
}

interface GitHubDeviceTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubDeviceAuthStartPayload {
  credentialId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  expiresAtMs: number;
  intervalSeconds: number;
}

export type GitHubDeviceAuthPendingPayload = {
  status: 'pending';
  intervalSeconds: number;
  expiresAtMs: number;
  nextPollAtMs: number;
};

export type GitHubDeviceAuthCompletePayload = {
  status: 'complete';
  credentialId: string;
};

export type GitHubDeviceAuthFailedPayload = {
  status: 'failed';
  error: string;
};

export type GitHubDeviceAuthPollResult =
  | GitHubDeviceAuthPendingPayload
  | GitHubDeviceAuthCompletePayload
  | GitHubDeviceAuthFailedPayload;

function encodeFormBody(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

async function postGitHubForm<T>(
  url: string,
  entries: Record<string, string>,
  label: string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'myelin',
    },
    body: encodeFormBody(entries),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '<no response body>');
    throw new Error(`${label} (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
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
  const detail = trimmed || 'GitHub device authorization failed.';
  return `GitHub device authorization failed: ${error} (${detail})`;
}

export async function isGitHubSecureStorageAvailable(): Promise<boolean> {
  try {
    await getGitHubStrongholdStore();
    return true;
  } catch {
    return false;
  }
}

export async function getGitHubToken(credentialId: string): Promise<string> {
  const token = await readGitHubToken(credentialId);
  if (!token) {
    throw new Error('GitHub token is not configured.');
  }

  return token;
}

export async function hasGitHubToken(credentialId: string): Promise<boolean> {
  return Boolean(await readGitHubToken(credentialId));
}

export async function storeGitHubToken(
  credentialId: string,
  token: string,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('GitHub token cannot be empty.');
  }

  await withGitHubStronghold(async (store, stronghold) => {
    const bytes = Array.from(new TextEncoder().encode(trimmed));
    await store.insert(getGitHubTokenKey(credentialId), bytes);
    await stronghold.save();
  });
}

export async function clearGitHubToken(credentialId: string): Promise<void> {
  await withGitHubStronghold(async (store, stronghold) => {
    await store.remove(getGitHubTokenKey(credentialId));
    await stronghold.save();
  });
}

export async function isGitHubDeviceAuthAvailable(): Promise<boolean> {
  try {
    getGitHubClientId();
  } catch {
    return false;
  }

  return isGitHubSecureStorageAvailable();
}

export async function beginGitHubDeviceAuth(
  credentialId: string,
): Promise<GitHubDeviceAuthStartPayload> {
  const normalized = normalizeCredentialId(credentialId);
  const clientId = getGitHubClientId();

  const payload = await postGitHubForm<GitHubDeviceCodeResponse>(
    GITHUB_DEVICE_CODE_URL,
    { client_id: clientId, scope: GITHUB_OAUTH_SCOPE },
    'GitHub device auth request failed',
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
    verificationUri: payload.verification_uri,
    verificationUriComplete: payload.verification_uri_complete ?? null,
    expiresAtMs,
    intervalSeconds,
  };
}

export async function openGitHubDeviceAuth(
  payload: GitHubDeviceAuthStartPayload,
): Promise<void> {
  await openUrl(payload.verificationUriComplete ?? payload.verificationUri);
}

export async function startGitHubDeviceAuth(
  credentialId: string,
): Promise<GitHubDeviceAuthStartPayload> {
  const payload = await beginGitHubDeviceAuth(credentialId);
  await openGitHubDeviceAuth(payload);
  return payload;
}

export async function pollGitHubDeviceAuth(
  credentialId: string,
): Promise<GitHubDeviceAuthPollResult> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingDeviceAuthSessions.get(normalized);
  if (!session) {
    throw new Error('No active GitHub device authorization session.');
  }

  const now = Date.now();
  if (now >= session.expiresAtMs) {
    pendingDeviceAuthSessions.delete(normalized);
    return {
      status: 'failed',
      error: 'GitHub device authorization expired. Start sign-in again.',
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

  const clientId = getGitHubClientId();
  const response = await postGitHubForm<GitHubDeviceTokenResponse>(
    GITHUB_TOKEN_URL,
    {
      client_id: clientId,
      device_code: session.deviceCode,
      grant_type: GITHUB_DEVICE_GRANT_TYPE,
    },
    'GitHub device auth poll failed',
  );

  if (response.access_token) {
    const trimmed = response.access_token.trim();
    if (!trimmed) {
      pendingDeviceAuthSessions.delete(normalized);
      return {
        status: 'failed',
        error: 'GitHub device authorization returned an empty access token.',
      };
    }

    pendingDeviceAuthSessions.delete(normalized);
    await storeGitHubToken(normalized, trimmed);
    return { status: 'complete', credentialId: normalized };
  }

  const error = response.error ?? 'unknown_error';
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
    default: {
      pendingDeviceAuthSessions.delete(normalized);
      return {
        status: 'failed',
        error: deviceAuthFailureMessage(error, response.error_description),
      };
    }
  }
}

export async function cancelGitHubDeviceAuth(
  credentialId: string,
): Promise<void> {
  pendingDeviceAuthSessions.delete(normalizeCredentialId(credentialId));
}

export async function waitForGitHubDeviceAuth(
  credentialId: string,
  options?: {
    signal?: AbortSignal;
    onPending?: (result: GitHubDeviceAuthPendingPayload) => void;
  },
): Promise<GitHubDeviceAuthCompletePayload | GitHubDeviceAuthFailedPayload> {
  const normalized = normalizeCredentialId(credentialId);
  for (;;) {
    if (options?.signal?.aborted) {
      throw new Error('GitHub device authorization wait aborted.');
    }

    const result = await pollGitHubDeviceAuth(normalized);
    if (result.status !== 'pending') {
      return result;
    }

    options?.onPending?.(result);
    const delayMs = Math.max(250, result.nextPollAtMs - Date.now());
    await sleep(delayMs);
  }
}
