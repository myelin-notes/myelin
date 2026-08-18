import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  beginGitHubOAuth,
  cancelGitHubOAuth,
  clearGitHubToken,
  consumeGitHubVaultDiscarded,
  hasGitHubToken,
  isGitHubOAuthAvailable,
  openGitHubOAuth,
  waitForGitHubOAuth,
} from '@/lib/sync';

const PROVIDER_NAME = 'GitHub';

export interface GitHubAuthState {
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

export function useGitHubAuth(credentialId: string): GitHubAuthState {
  const strings = useMessages();
  const [tokenPresent, setTokenPresent] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [authAvailable, setAuthAvailable] = useState(true);
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const logger = useRef(new Logger(`OAuth:${PROVIDER_NAME}`));
  const abortRef = useRef<AbortController | null>(null);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const [available, has] = await Promise.all([
        isGitHubOAuthAvailable(),
        hasGitHubToken(credentialId),
      ]);

      setAuthAvailable(available);
      setTokenPresent(has);
      if (has) {
        setAuthError(null);
      }
      if (consumeGitHubVaultDiscarded()) {
        toast.warning(
          strings.settings.repository.auth.notices.credentialReset(
            PROVIDER_NAME,
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
    credentialId,
    strings.settings.repository.auth.errors.readState,
    strings.settings.repository.auth.notices.credentialReset,
  ]);

  useEffect(() => {
    void checkToken();
  }, [checkToken]);

  // Abandoning the flow (unmount) has to tear down the redirect listener too,
  // otherwise the loopback server or deep link handler outlives the attempt.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void cancelGitHubOAuth(credentialId);
    };
  }, [credentialId]);

  const signIn = useCallback(async () => {
    setAuthError(null);

    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;

    try {
      const payload = await beginGitHubOAuth(credentialId);
      if (abort.signal.aborted) {
        return;
      }

      setAwaitingRedirect(true);
      await openGitHubOAuth(payload);

      const result = await waitForGitHubOAuth(credentialId, {
        signal: abort.signal,
      });

      if (abort.signal.aborted) {
        return;
      }

      if (result.status === 'complete') {
        setTokenPresent(true);
        setAuthError(null);
        trackEvent('github_auth_completed', { credential_id: credentialId });
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
      trackEvent('github_auth_failed', {
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
  }, [credentialId, strings.settings.repository.auth.errors.signIn]);

  const cancelAuth = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAwaitingRedirect(false);
    await cancelGitHubOAuth(credentialId);
  }, [credentialId]);

  const signOut = useCallback(async () => {
    await clearGitHubToken(credentialId);
    setTokenPresent(false);
    setAuthError(null);
  }, [credentialId]);

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
