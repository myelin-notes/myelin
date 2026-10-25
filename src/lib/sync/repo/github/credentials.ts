import { toast } from 'sonner';
import { fetch } from '@tauri-apps/plugin-http';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '@/lib/env';
import { createCredentialVault } from '../credential-vault';
import {
  credentialTokenKey,
  normalizeCredentialId,
  OAuthClient,
  type OAuthExchange,
  type OAuthResult,
  type OAuthStartPayload,
} from '../oauth/client';
import { encodeFormBody } from '../oauth/pkce';

export const GITHUB_PROVIDER_NAME = 'GitHub';

const vault = createCredentialVault({
  filename: 'github-credentials.hold',
  clientName: 'github',
  passwordPref: 'githubVaultPassword',
});

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_OAUTH_SCOPE = 'repo offline_access';
export const GITHUB_SIGN_IN_REQUIRED =
  'GitHub access expired or was revoked. Sign in again from Settings to resume sync.';

function getGitHubClientId(): string {
  if (!GITHUB_CLIENT_ID) {
    throw new Error('VITE_GITHUB_CLIENT_ID is not configured.');
  }
  return GITHUB_CLIENT_ID;
}

// GitHub demands a client secret even on the PKCE flow, since it draws no
// distinction between public and confidential clients. See lib/env.ts.
function getGitHubClientSecret(): string {
  if (!GITHUB_CLIENT_SECRET) {
    throw new Error('VITE_GITHUB_CLIENT_SECRET is not configured.');
  }
  return GITHUB_CLIENT_SECRET;
}

export function consumeGitHubVaultDiscarded(): boolean {
  return vault.consumeDiscarded();
}

interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

export type GitHubOAuthStartPayload = OAuthStartPayload;
export type GitHubOAuthResult = OAuthResult;

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
    const payload = await response.json().catch(() => null);
    if (
      (response.status === 400 || response.status === 401) &&
      payload?.error
    ) {
      return payload as T;
    }
    throw new Error(`${label} (${response.status}). Please try again.`);
  }

  return (await response.json()) as T;
}

function oauthFailureMessage(
  error: string,
  description: string | null | undefined,
): string {
  const trimmed = (description ?? '').trim();
  const detail = trimmed || 'GitHub authorization failed.';
  return `GitHub authorization failed: ${error} (${detail})`;
}

export async function isGitHubSecureStorageAvailable(): Promise<boolean> {
  return vault.isAvailable();
}

interface StoredGitHubToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
}

const pendingRefreshes = new Map<string, Promise<string>>();

function tokenRecord(response: GitHubTokenResponse): StoredGitHubToken {
  return {
    accessToken: response.access_token!.trim(),
    refreshToken: response.refresh_token,
    expiresAt:
      response.expires_in === undefined
        ? undefined
        : Date.now() + response.expires_in * 1000,
    refreshExpiresAt:
      response.refresh_token_expires_in === undefined
        ? undefined
        : Date.now() + response.refresh_token_expires_in * 1000,
  };
}

export async function requireGitHubSignIn(credentialId: string): Promise<void> {
  if (await hasGitHubToken(credentialId)) {
    toast.warning(GITHUB_SIGN_IN_REQUIRED, {
      id: `github-auth:${credentialId}`,
      duration: Infinity,
    });
    await clearGitHubToken(credentialId);
  }
}

export async function getGitHubToken(
  credentialId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const normalized = normalizeCredentialId(credentialId);
  const value = await vault.read(credentialTokenKey(normalized));
  const existing = pendingRefreshes.get(normalized);
  if (existing) {
    return existing;
  }
  if (!value) {
    throw new Error(GITHUB_SIGN_IN_REQUIRED);
  }
  // Older vaults stored only the access token.
  const stored: StoredGitHubToken = value.startsWith('{')
    ? JSON.parse(value)
    : { accessToken: value };
  if (
    !options.forceRefresh &&
    (stored.expiresAt === undefined || stored.expiresAt > Date.now() + 60_000)
  ) {
    return stored.accessToken;
  }
  const pending = refreshGitHubToken(normalized, stored, value).finally(() =>
    pendingRefreshes.delete(normalized),
  );
  pendingRefreshes.set(normalized, pending);
  return pending;
}

async function refreshGitHubToken(
  credentialId: string,
  stored: StoredGitHubToken,
  originalValue: string,
): Promise<string> {
  if (
    !stored.refreshToken ||
    (stored.refreshExpiresAt !== undefined &&
      stored.refreshExpiresAt <= Date.now())
  ) {
    await requireGitHubSignIn(credentialId);
    throw new Error(GITHUB_SIGN_IN_REQUIRED);
  }
  const response = await postGitHubForm<GitHubTokenResponse>(
    GITHUB_TOKEN_URL,
    {
      client_id: getGitHubClientId(),
      client_secret: getGitHubClientSecret(),
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    },
    'GitHub token refresh failed',
  );
  if ((await vault.read(credentialTokenKey(credentialId))) !== originalValue) {
    throw new Error('GitHub credentials changed. Please try syncing again.');
  }
  if (
    response.error === 'bad_refresh_token' ||
    response.error === 'invalid_grant' ||
    response.error === 'expired_token'
  ) {
    await requireGitHubSignIn(credentialId);
    throw new Error(GITHUB_SIGN_IN_REQUIRED);
  }
  if (response.error) {
    throw new Error(
      oauthFailureMessage(response.error, response.error_description),
    );
  }
  if (!response.access_token?.trim() || !response.refresh_token?.trim()) {
    throw new Error(
      'GitHub token refresh returned an incomplete token pair. Please try again.',
    );
  }
  const next = tokenRecord(response);
  await vault.write(credentialTokenKey(credentialId), JSON.stringify(next), {
    notify: false,
  });
  return next.accessToken;
}

export async function hasGitHubToken(credentialId: string): Promise<boolean> {
  return Boolean(await vault.read(credentialTokenKey(credentialId)));
}

export async function storeGitHubToken(
  credentialId: string,
  token: string,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('GitHub token cannot be empty.');
  }

  await vault.write(credentialTokenKey(credentialId), trimmed);
}

export async function clearGitHubToken(credentialId: string): Promise<void> {
  await vault.remove(credentialTokenKey(credentialId));
}

export async function isGitHubOAuthAvailable(): Promise<boolean> {
  try {
    getGitHubClientId();
    getGitHubClientSecret();
  } catch {
    return false;
  }

  return isGitHubSecureStorageAvailable();
}

async function exchangeGitHubCode({
  credentialId,
  code,
  codeVerifier,
  redirectUri,
}: OAuthExchange): Promise<OAuthResult> {
  const response = await postGitHubForm<GitHubTokenResponse>(
    GITHUB_TOKEN_URL,
    {
      client_id: getGitHubClientId(),
      client_secret: getGitHubClientSecret(),
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    },
    'GitHub token exchange failed',
  );

  if (response.error) {
    return {
      status: 'failed',
      error: oauthFailureMessage(response.error, response.error_description),
    };
  }

  const token = response.access_token?.trim();
  if (!token) {
    return {
      status: 'failed',
      error: 'GitHub authorization returned an empty access token.',
    };
  }

  await vault.write(
    credentialTokenKey(credentialId),
    JSON.stringify(tokenRecord(response)),
  );
  toast.dismiss(`github-auth:${credentialId}`);
  return { status: 'complete', credentialId };
}

const oauth = new OAuthClient({
  provider: GITHUB_PROVIDER_NAME,
  authorizeUrl: GITHUB_AUTHORIZE_URL,
  scope: GITHUB_OAUTH_SCOPE,
  resolveClientId: () => {
    // The secret is checked alongside the id: a missing one only surfaces at
    // the token exchange otherwise.
    getGitHubClientSecret();
    return getGitHubClientId();
  },
  exchange: exchangeGitHubCode,
});

export function beginGitHubOAuth(
  credentialId: string,
): Promise<GitHubOAuthStartPayload> {
  return oauth.begin(credentialId);
}

export function openGitHubOAuth(
  payload: GitHubOAuthStartPayload,
): Promise<void> {
  return oauth.open(payload);
}

export function waitForGitHubOAuth(
  credentialId: string,
  options?: { signal?: AbortSignal },
): Promise<GitHubOAuthResult> {
  return oauth.wait(credentialId, options);
}

export function cancelGitHubOAuth(credentialId: string): Promise<void> {
  return oauth.cancel(credentialId);
}
