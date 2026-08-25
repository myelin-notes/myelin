import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { trackEvent } from '@/lib/analytics';

export interface RemoteAuthState {
  tokenPresent: boolean;
  checkingToken: boolean;
  authAvailable: boolean;
  /** True while the browser is open and the redirect has not come back yet. */
  awaitingRedirect: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  cancelAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

export type RemoteOAuthResult =
  | { status: 'complete'; credentialId: string }
  | { status: 'failed'; error: string };

/**
 * The provider-specific half of the sign-in flow. GitHub and Google Drive both
 * run authorization code + PKCE through the same redirect listener, so only the
 * endpoints and the credential store differ.
 */
export interface RemoteOAuthProvider<TStartPayload> {
  /** Display name, used in copy and in the analytics event prefix. */
  name: string;
  /** Prefix for `<prefix>_auth_completed` / `<prefix>_auth_failed`. */
  analyticsPrefix: string;
  isAuthAvailable: () => Promise<boolean>;
  hasToken: (credentialId: string) => Promise<boolean>;
  consumeVaultDiscarded: () => boolean;
  begin: (credentialId: string) => Promise<TStartPayload>;
  open: (payload: TStartPayload) => Promise<void>;
  wait: (
    credentialId: string,
    options: { signal: AbortSignal },
  ) => Promise<RemoteOAuthResult>;
  cancel: (credentialId: string) => Promise<void>;
  clearToken: (credentialId: string) => Promise<void>;
}

/**
 * `enabled` gates the state read: opening a provider's vault creates its
 * snapshot file and password, so the unselected provider must not be touched
 * just because both hooks mount.
 */
export function useRemoteAuth<TStartPayload>(
  provider: RemoteOAuthProvider<TStartPayload>,
  credentialId: string,
  enabled: boolean,
): RemoteAuthState {
  const strings = useMessages();
  const [tokenPresent, setTokenPresent] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [authAvailable, setAuthAvailable] = useState(true);
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const logger = useRef(new Logger(`OAuth:${provider.name}`));
  const abortRef = useRef<AbortController | null>(null);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const [available, has] = await Promise.all([
        provider.isAuthAvailable(),
        provider.hasToken(credentialId),
      ]);

      setAuthAvailable(available);
      setTokenPresent(has);
      if (has) {
        setAuthError(null);
      }
      if (provider.consumeVaultDiscarded()) {
        toast.warning(
          strings.settings.repository.auth.notices.credentialReset(
            provider.name,
          ),
        );
      }
    } catch (error) {
      logger.current.error('Failed to read OAuth state', error, {
        credentialId,
      });
      setTokenPresent(false);
      setAuthError(
        error instanceof Error
          ? error.message
          : strings.settings.repository.auth.errors.readState,
      );
    } finally {
      setCheckingToken(false);
    }
  }, [
    provider,
    credentialId,
    strings.settings.repository.auth.errors.readState,
    strings.settings.repository.auth.notices.credentialReset,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void checkToken();
  }, [enabled, checkToken]);

  // Abandoning the flow (unmount) has to tear down the redirect listener too,
  // otherwise the loopback server or deep link handler outlives the attempt.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void provider.cancel(credentialId);
    };
  }, [provider, credentialId]);

  const signIn = useCallback(async () => {
    setAuthError(null);

    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;

    try {
      const payload = await provider.begin(credentialId);
      if (abort.signal.aborted) {
        return;
      }

      setAwaitingRedirect(true);
      await provider.open(payload);

      const result = await provider.wait(credentialId, {
        signal: abort.signal,
      });

      if (abort.signal.aborted) {
        return;
      }

      if (result.status === 'complete') {
        setTokenPresent(true);
        setAuthError(null);
        trackEvent(`${provider.analyticsPrefix}_auth_completed`, {
          credential_id: credentialId,
        });
      } else {
        logger.current.error('OAuth flow failed', undefined, {
          credentialId,
          reason: result.error,
        });
        setAuthError(result.error);
      }
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      logger.current.error('OAuth sign-in threw', error, { credentialId });
      trackEvent(`${provider.analyticsPrefix}_auth_failed`, {
        credential_id: credentialId,
        error_message: error instanceof Error ? error.name : 'unknown',
      });
      setAuthError(
        error instanceof Error
          ? error.message
          : strings.settings.repository.auth.errors.signIn,
      );
    } finally {
      if (!abort.signal.aborted) {
        setAwaitingRedirect(false);
      }
    }
  }, [provider, credentialId, strings.settings.repository.auth.errors.signIn]);

  const cancelAuth = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAwaitingRedirect(false);
    await provider.cancel(credentialId);
  }, [provider, credentialId]);

  const signOut = useCallback(async () => {
    await provider.clearToken(credentialId);
    setTokenPresent(false);
    setAuthError(null);
  }, [provider, credentialId]);

  return {
    tokenPresent,
    checkingToken,
    authAvailable,
    awaitingRedirect,
    authError,
    signIn,
    cancelAuth,
    signOut,
  };
}
