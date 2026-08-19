import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '@/lib/env';
import { Logger } from '@/lib/logger';
import { createCredentialVault } from './credential-vault';
import {
  deriveCodeChallenge,
  encodeFormBody,
  raceAbort,
  randomUrlSafeToken,
} from './oauth/pkce';
import {
  type OAuthRedirectListener,
  startOAuthRedirectListener,
} from './oauth/redirect';

const logger = new Logger('GitHubCredentials');

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

interface PendingOAuthSession {
  codeVerifier: string;
  state: string;
  listener: OAuthRedirectListener;
}

const pendingOAuthSessions = new Map<string, PendingOAuthSession>();

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubOAuthStartPayload {
  credentialId: string;
  authorizeUrl: string;
}

export type GitHubOAuthCompletePayload = {
  status: 'complete';
  credentialId: string;
};

export type GitHubOAuthFailedPayload = {
  status: 'failed';
  error: string;
};

export type GitHubOAuthResult =
  | GitHubOAuthCompletePayload
  | GitHubOAuthFailedPayload;

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
  const token = await vault.read(getGitHubTokenKey(credentialId));
  if (!token) {
    throw new Error('GitHub token is not configured.');
  }

  return token;
}

export async function hasGitHubToken(credentialId: string): Promise<boolean> {
  return Boolean(await vault.read(getGitHubTokenKey(credentialId)));
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

export async function isGitHubOAuthAvailable(): Promise<boolean> {
  try {
    getGitHubClientId();
    getGitHubClientSecret();
  } catch {
    return false;
  }

  return isGitHubSecureStorageAvailable();
}

/**
 * Starts the authorization code flow with PKCE. The redirect listener is opened
 * before the URL is handed back so the callback cannot land before anything is
 * ready to catch it; the caller must follow up with `waitForGitHubOAuth` or
 * `cancelGitHubOAuth` so the listener is torn down either way.
 */
export async function beginGitHubOAuth(
  credentialId: string,
): Promise<GitHubOAuthStartPayload> {
  const normalized = normalizeCredentialId(credentialId);
  const clientId = getGitHubClientId();
  // Checked up front: a missing secret only surfaces at token exchange
  // otherwise, after the user has already authorized in the browser.
  getGitHubClientSecret();

  await cancelGitHubOAuth(normalized);

  const codeVerifier = randomUrlSafeToken();
  const state = randomUrlSafeToken();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const listener = await startOAuthRedirectListener({
    provider: GITHUB_PROVIDER_NAME,
  });
  pendingOAuthSessions.set(normalized, { codeVerifier, state, listener });

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: listener.redirectUri,
    scope: GITHUB_OAUTH_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    credentialId: normalized,
    authorizeUrl: `${GITHUB_AUTHORIZE_URL}?${query.toString()}`,
  };
}

export async function openGitHubOAuth(
  payload: GitHubOAuthStartPayload,
): Promise<void> {
  await openUrl(payload.authorizeUrl);
}

export async function waitForGitHubOAuth(
  credentialId: string,
  options?: { signal?: AbortSignal },
): Promise<GitHubOAuthResult> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingOAuthSessions.get(normalized);
  if (!session) {
    throw new Error('No active GitHub authorization session.');
  }

  try {
    const params = await raceAbort(
      session.listener.wait(),
      options?.signal,
      'GitHub authorization wait aborted.',
    );

    if (params.error) {
      return {
        status: 'failed',
        error: oauthFailureMessage(params.error, params.errorDescription),
      };
    }

    // A mismatched state means the redirect did not originate from the request
    // this app made, so the code that came with it is not ours to redeem.
    if (params.state !== session.state) {
      return {
        status: 'failed',
        error: 'GitHub authorization state did not match. Start sign-in again.',
      };
    }

    if (!params.code) {
      return {
        status: 'failed',
        error: 'GitHub authorization returned no code.',
      };
    }

    const response = await postGitHubForm<GitHubTokenResponse>(
      GITHUB_TOKEN_URL,
      {
        client_id: getGitHubClientId(),
        client_secret: getGitHubClientSecret(),
        code: params.code,
        code_verifier: session.codeVerifier,
        redirect_uri: session.listener.redirectUri,
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

    await storeGitHubToken(normalized, token);
    return { status: 'complete', credentialId: normalized };
  } finally {
    await cancelGitHubOAuth(normalized);
  }
}

export async function cancelGitHubOAuth(credentialId: string): Promise<void> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingOAuthSessions.get(normalized);
  if (!session) {
    return;
  }

  pendingOAuthSessions.delete(normalized);
  await session.listener.cancel().catch((error) => {
    logger.warn('Failed to close GitHub OAuth redirect listener', error);
  });
}
