import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeCredentialChanges } from '../credential-vault';
import type { OAuthCallbackParams } from '../oauth/redirect';

// The shared setup replaces this module wholesale for consumers that only need
// a token; here the real implementation is what's under test.
vi.unmock('@/lib/sync/repo/github/credentials');

vi.mock('@/lib/env', () => ({
  IS_DEV: false,
  MODE: 'test',
  IS_MOBILE_BUILD: false,
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  LIVE_DISCOVERY_URL: 'https://live.test',
  POSTHOG_KEY: '',
  POSTHOG_HOST: '',
}));

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), dismiss: vi.fn() } }));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => {}),
}));

const REDIRECT_URI = 'http://127.0.0.1:54321/oauth/callback';

let resolveRedirect: (params: OAuthCallbackParams) => void;
const cancelListener = vi.fn(async () => {});

vi.mock('../oauth/redirect', () => ({
  startOAuthRedirectListener: async () => ({
    redirectUri: REDIRECT_URI,
    wait: () =>
      new Promise<OAuthCallbackParams>((resolve) => {
        resolveRedirect = resolve;
      }),
    cancel: cancelListener,
  }),
}));

const storedSecrets = new Map<string, Uint8Array>();

vi.mock('@tauri-apps/plugin-stronghold', () => ({
  Stronghold: {
    load: async () => ({
      save: async () => {},
      loadClient: async () => ({
        getStore: () => ({
          get: async (key: string) => storedSecrets.get(key) ?? null,
          insert: async (key: string, value: number[]) => {
            storedSecrets.set(key, Uint8Array.from(value));
          },
          remove: async (key: string) => {
            storedSecrets.delete(key);
          },
        }),
      }),
      createClient: async () => {
        throw new Error('unreachable: loadClient always succeeds here');
      },
    }),
  },
}));

interface TokenRequest {
  url: string;
  body: Record<string, string>;
}

const tokenRequests: TokenRequest[] = [];
let tokenStatus = 200;
const apiStatuses: number[] = [];
const apiAuthorizations: string[] = [];
let tokenResponse: Record<string, unknown> = {
  access_token: 'gho_testtoken',
};

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: async (
    url: string,
    init: { body?: string; headers?: Record<string, string> },
  ) => {
    if (url.startsWith('https://api.github.com')) {
      apiAuthorizations.push(init.headers?.Authorization ?? '');
      const status = apiStatuses.shift() ?? 200;
      return new Response(JSON.stringify({ login: 'test-user' }), { status });
    }
    tokenRequests.push({
      url,
      body: Object.fromEntries(new URLSearchParams(init.body ?? '')),
    });
    return {
      ok: tokenStatus === 200,
      status: tokenStatus,
      json: async () => tokenResponse,
      text: async () => JSON.stringify(tokenResponse),
    };
  },
}));

const {
  beginGitHubOAuth,
  cancelGitHubOAuth,
  getGitHubToken,
  hasGitHubToken,
  storeGitHubToken,
  GITHUB_SIGN_IN_REQUIRED,
  waitForGitHubOAuth,
} = await import('./credentials');

const { fetchGitHubUser } = await import('./api');

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('GitHub OAuth authorization code flow', () => {
  beforeEach(() => {
    storedSecrets.clear();
    tokenStatus = 200;
    apiStatuses.length = 0;
    apiAuthorizations.length = 0;
    vi.mocked(toast.warning).mockClear();
    tokenRequests.length = 0;
    tokenResponse = { access_token: 'gho_testtoken' };
    cancelListener.mockClear();
  });

  it('binds the authorization code to the PKCE verifier it generated', async () => {
    const { authorizeUrl } = await beginGitHubOAuth('default');
    const query = new URL(authorizeUrl).searchParams;

    expect(
      authorizeUrl.startsWith('https://github.com/login/oauth/authorize'),
    ).toBe(true);
    expect(query.get('client_id')).toBe('test-client-id');
    expect(query.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(query.get('code_challenge_method')).toBe('S256');

    const pending = waitForGitHubOAuth('default');
    resolveRedirect({
      code: 'auth-code',
      state: query.get('state'),
      error: null,
      errorDescription: null,
    });

    await expect(pending).resolves.toEqual({
      status: 'complete',
      credentialId: 'default',
    });

    expect(tokenRequests).toHaveLength(1);
    const [exchange] = tokenRequests;
    expect(exchange.body.code).toBe('auth-code');
    expect(exchange.body.client_secret).toBe('test-client-secret');
    expect(exchange.body.redirect_uri).toBe(REDIRECT_URI);
    // The verifier sent at exchange time must be the preimage of the challenge
    // sent at authorization time, or PKCE is decorative.
    await expect(sha256Base64Url(exchange.body.code_verifier)).resolves.toBe(
      query.get('code_challenge'),
    );

    await expect(getGitHubToken('default')).resolves.toBe('gho_testtoken');
  });

  async function signInWithRefreshToken(expiresIn = 3600) {
    tokenResponse = {
      access_token: 'old-access',
      refresh_token: 'refresh-1',
      expires_in: expiresIn,
      refresh_token_expires_in: 36000,
    };
    const { authorizeUrl } = await beginGitHubOAuth('default');
    expect(new URL(authorizeUrl).searchParams.get('scope')).toBe(
      'repo offline_access',
    );
    const pending = waitForGitHubOAuth('default');
    resolveRedirect({
      code: 'code',
      state: new URL(authorizeUrl).searchParams.get('state'),
      error: null,
      errorDescription: null,
    });
    await expect(pending).resolves.toMatchObject({ status: 'complete' });
    tokenRequests.length = 0;
    tokenResponse = {
      access_token: 'new-access',
      refresh_token: 'refresh-2',
      expires_in: 3600,
      refresh_token_expires_in: 36000,
    };
  }

  it('refreshes an expired token once for concurrent callers and persists the rotated pair silently', async () => {
    await signInWithRefreshToken(0);
    const changed = vi.fn();
    const unsubscribe = subscribeCredentialChanges(changed);
    try {
      await expect(
        Promise.all([getGitHubToken('default'), getGitHubToken(' default ')]),
      ).resolves.toEqual(['new-access', 'new-access']);
      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0].body).toMatchObject({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-1',
      });
      await expect(getGitHubToken('default')).resolves.toBe('new-access');
      expect(tokenRequests).toHaveLength(1);
      await getGitHubToken('default', { forceRefresh: true });
      expect(tokenRequests[1].body.refresh_token).toBe('refresh-2');
      expect(changed).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('honors forced refresh while another caller reads an unexpired token', async () => {
    await signInWithRefreshToken();
    const ordinaryRead = getGitHubToken('default');
    const forcedRead = getGitHubToken('default', { forceRefresh: true });
    await ordinaryRead;
    await expect(forcedRead).resolves.toBe('new-access');
    expect(tokenRequests).toHaveLength(1);
  });

  it('retries a rejected API request with refreshed credentials', async () => {
    await signInWithRefreshToken();
    apiStatuses.push(401, 200);
    await expect(fetchGitHubUser('default')).resolves.toMatchObject({
      login: 'test-user',
    });
    expect(apiAuthorizations).toEqual([
      'Bearer old-access',
      'Bearer new-access',
    ]);
    expect(tokenRequests).toHaveLength(1);
  });

  it('prompts for sign-in when refreshed credentials are also rejected', async () => {
    await signInWithRefreshToken();
    apiStatuses.push(401, 401);
    await expect(fetchGitHubUser('default')).rejects.toThrow(
      GITHUB_SIGN_IN_REQUIRED,
    );
    expect(apiAuthorizations).toHaveLength(2);
    await expect(hasGitHubToken('default')).resolves.toBe(false);
    expect(toast.warning).toHaveBeenCalledWith(
      GITHUB_SIGN_IN_REQUIRED,
      expect.any(Object),
    );
  });

  it('keeps legacy tokens usable but prompts for sign-in if rejected', async () => {
    await storeGitHubToken('default', 'legacy-token');
    await expect(getGitHubToken('default')).resolves.toBe('legacy-token');
    apiStatuses.push(401);
    await expect(fetchGitHubUser('default')).rejects.toThrow(
      GITHUB_SIGN_IN_REQUIRED,
    );
    expect(tokenRequests).toHaveLength(0);
    await expect(hasGitHubToken('default')).resolves.toBe(false);
  });

  it('clears a rejected refresh token but retains credentials on transient failures', async () => {
    await signInWithRefreshToken(0);
    tokenStatus = 503;
    await expect(getGitHubToken('default')).rejects.toThrow('(503)');
    await expect(hasGitHubToken('default')).resolves.toBe(true);
    expect(toast.warning).not.toHaveBeenCalled();
    tokenStatus = 400;
    tokenResponse = { error: 'bad_refresh_token' };
    await expect(getGitHubToken('default')).rejects.toThrow(
      GITHUB_SIGN_IN_REQUIRED,
    );
    await expect(hasGitHubToken('default')).resolves.toBe(false);
    expect(toast.warning).toHaveBeenCalled();
  });

  it('refuses a callback whose state does not match', async () => {
    await beginGitHubOAuth('default');

    const pending = waitForGitHubOAuth('default');
    resolveRedirect({
      code: 'auth-code',
      state: 'not-the-state-we-sent',
      error: null,
      errorDescription: null,
    });

    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(tokenRequests).toHaveLength(0);
    await expect(getGitHubToken('default')).rejects.toThrow();
  });

  it('surfaces an authorization error without exchanging anything', async () => {
    await beginGitHubOAuth('default');

    const pending = waitForGitHubOAuth('default');
    resolveRedirect({
      code: null,
      state: null,
      error: 'access_denied',
      errorDescription: 'The user denied access',
    });

    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toContain(
      'access_denied',
    );
    expect(tokenRequests).toHaveLength(0);
  });

  it('tears the listener down when the flow is cancelled', async () => {
    await beginGitHubOAuth('default');
    await cancelGitHubOAuth('default');

    expect(cancelListener).toHaveBeenCalledTimes(1);
    await expect(waitForGitHubOAuth('default')).rejects.toThrow(
      'No active GitHub authorization session.',
    );
  });
});
