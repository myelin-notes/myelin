import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthCallbackParams } from './oauth/redirect';

// The shared setup replaces this module wholesale for consumers that only need
// a token; here the real implementation is what's under test.
vi.unmock('@/lib/sync/repo/github-credentials');

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

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => {}),
}));

const REDIRECT_URI = 'http://127.0.0.1:54321/oauth/callback';

let resolveRedirect: (params: OAuthCallbackParams) => void;
const cancelListener = vi.fn(async () => {});

vi.mock('./oauth/redirect', () => ({
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
let tokenResponse: Record<string, unknown> = {
  access_token: 'gho_testtoken',
};

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: async (url: string, init: { body?: string }) => {
    tokenRequests.push({
      url,
      body: Object.fromEntries(new URLSearchParams(init.body ?? '')),
    });
    return {
      ok: true,
      status: 200,
      json: async () => tokenResponse,
      text: async () => JSON.stringify(tokenResponse),
    };
  },
}));

const {
  beginGitHubOAuth,
  cancelGitHubOAuth,
  getGitHubToken,
  waitForGitHubOAuth,
} = await import('./github-credentials');

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
