import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GITHUB_CLIENT_ID } from '@/lib/env';
import { createCredentialVault } from './credential-vault';

const vault = createCredentialVault({
  filename: 'github-credentials.hold',
  clientName: 'github',
  passwordPref: 'githubVaultPassword',
});

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

export function consumeGitHubVaultDiscarded(): boolean {
  return vault.consumeDiscarded();
}

async function readGitHubToken(credentialId: string): Promise<string | null> {
  return vault.read(getGitHubTokenKey(credentialId));
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
  return vault.isAvailable();
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

  await vault.write(getGitHubTokenKey(credentialId), trimmed);
}

export async function clearGitHubToken(credentialId: string): Promise<void> {
  await vault.remove(getGitHubTokenKey(credentialId));
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
