/**
 * The provider-neutral half of an authorization code + PKCE sign-in: one pending session per
 * credential, the redirect listener's lifetime, and the checks that must pass before a code is
 * worth redeeming. Providers supply their endpoints and their own token exchange — GitHub stores
 * a bare access token, Google a refresh token and expiry.
 */

import { Logger } from '@myelin/shared/logger';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  deriveCodeChallenge,
  encodeFormBody,
  raceAbort,
  randomUrlSafeToken,
} from './pkce';
import {
  type OAuthRedirectListener,
  startOAuthRedirectListener,
} from './redirect';

export interface OAuthStartPayload {
  credentialId: string;
  authorizeUrl: string;
}

export type OAuthResult =
  | { status: 'complete'; credentialId: string }
  | { status: 'failed'; error: string };

export interface OAuthExchange {
  credentialId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthClientOptions {
  /** Display name, shown in copy and in the redirect landing page. */
  provider: string;
  authorizeUrl: string;
  scope: string;
  /** Overrides the deep link the mobile flow listens for. */
  mobileRedirectUri?: string;
  /** Throws when the platform's client configuration is incomplete. */
  resolveClientId: () => string;
  /** Authorization parameters beyond the id, redirect, scope and PKCE set. */
  authorizeParams?: Record<string, string>;
  /** Redeems the code and persists whatever the provider hands back. */
  exchange: (input: OAuthExchange) => Promise<OAuthResult>;
}

export function normalizeCredentialId(credentialId?: string | null): string {
  const trimmed = typeof credentialId === 'string' ? credentialId.trim() : '';
  return trimmed || 'default';
}

/** Vault key holding one connected account's credentials. */
export function credentialTokenKey(credentialId: string): string {
  return `token:${normalizeCredentialId(credentialId)}`;
}

interface PendingOAuthSession {
  codeVerifier: string;
  state: string;
  listener: OAuthRedirectListener;
}

export class OAuthClient {
  private readonly logger: Logger;
  private readonly pendingSessions = new Map<string, PendingOAuthSession>();

  constructor(private readonly options: OAuthClientOptions) {
    this.logger = new Logger(`OAuth:${options.provider}`);
  }

  // The redirect listener opens before the URL is handed back, so the callback cannot land before
  // anything is ready to catch it. The caller must follow up with `wait` or `cancel` to tear it down.
  async begin(credentialId: string): Promise<OAuthStartPayload> {
    const normalized = normalizeCredentialId(credentialId);
    // Resolved up front: incomplete client config only surfaces at the token
    // exchange otherwise, after the user has already authorized in the browser.
    const clientId = this.options.resolveClientId();

    await this.cancel(normalized);

    const codeVerifier = randomUrlSafeToken();
    const state = randomUrlSafeToken();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);

    const listener = await startOAuthRedirectListener({
      provider: this.options.provider,
      mobileRedirectUri: this.options.mobileRedirectUri,
    });
    this.pendingSessions.set(normalized, { codeVerifier, state, listener });

    const query = encodeFormBody({
      client_id: clientId,
      redirect_uri: listener.redirectUri,
      scope: this.options.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...this.options.authorizeParams,
    });

    return {
      credentialId: normalized,
      authorizeUrl: `${this.options.authorizeUrl}?${query}`,
    };
  }

  async open(payload: OAuthStartPayload): Promise<void> {
    await openUrl(payload.authorizeUrl);
  }

  async wait(
    credentialId: string,
    options?: { signal?: AbortSignal },
  ): Promise<OAuthResult> {
    const { provider } = this.options;
    const normalized = normalizeCredentialId(credentialId);
    const session = this.pendingSessions.get(normalized);
    if (!session) {
      throw new Error(`No active ${provider} authorization session.`);
    }

    try {
      const params = await raceAbort(
        session.listener.wait(),
        options?.signal,
        `${provider} authorization wait aborted.`,
      );

      if (params.error) {
        const detail = (params.errorDescription ?? '').trim();
        return {
          status: 'failed',
          error: detail
            ? `${provider} authorization failed: ${params.error} (${detail})`
            : `${provider} authorization failed: ${params.error}`,
        };
      }

      // A mismatched state means the redirect did not originate from this app's request, so the code
      // that came with it is not ours to redeem.
      if (params.state !== session.state) {
        return {
          status: 'failed',
          error: `${provider} authorization state did not match. Start sign-in again.`,
        };
      }

      if (!params.code) {
        return {
          status: 'failed',
          error: `${provider} authorization returned no code.`,
        };
      }

      return await this.options.exchange({
        credentialId: normalized,
        code: params.code,
        codeVerifier: session.codeVerifier,
        redirectUri: session.listener.redirectUri,
      });
    } finally {
      await this.cancel(normalized);
    }
  }

  async cancel(credentialId: string): Promise<void> {
    const normalized = normalizeCredentialId(credentialId);
    const session = this.pendingSessions.get(normalized);
    if (!session) {
      return;
    }

    this.pendingSessions.delete(normalized);
    await session.listener.cancel().catch((error) => {
      this.logger.warn(
        `Failed to close ${this.options.provider} OAuth redirect listener`,
        error,
      );
    });
  }
}
