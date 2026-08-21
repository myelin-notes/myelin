import { fetch } from '@tauri-apps/plugin-http';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '@/lib/env';
import { createCredentialVault } from './credential-vault';
import {
  credentialTokenKey,
  OAuthClient,
  type OAuthExchange,
  type OAuthResult,
  type OAuthStartPayload,
} from './oauth/client';
import { encodeFormBody } from './oauth/pkce';

export const GITHUB_PROVIDER_NAME = 'GitHub';

const vault = createCredentialVault({
  filename: 'github-credentials.hold',
  clientName: 'github',
  passwordPref: 'githubVaultPassword',
});

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_OAUTH_SCOPE = 'repo';

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
    const body = await response.text().catch(() => '<no response body>');
    throw new Error(`${label} (${response.status}): ${body}`);
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

export async function getGitHubToken(credentialId: string): Promise<string> {
  const token = await vault.read(credentialTokenKey(credentialId));
  if (!token) {
    throw new Error('GitHub token is not configured.');
  }

  return token;
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

  await storeGitHubToken(credentialId, token);
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
