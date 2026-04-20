import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessages } from '@/lib/i18n';
import {
  beginGitHubDeviceAuth,
  cancelGitHubDeviceAuth,
  clearGitHubToken,
  hasGitHubToken,
  isGitHubDeviceAuthAvailable,
  openGitHubDeviceAuth,
  waitForGitHubDeviceAuth,
} from '@/lib/sync';

export interface GitHubAuthState {
  tokenPresent: boolean;
  checkingToken: boolean;
  authAvailable: boolean;
  polling: boolean;
  userCode: string | null;
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
  const [polling, setPolling] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const [available, has] = await Promise.all([
        isGitHubDeviceAuthAvailable(),
        hasGitHubToken(credentialId),
      ]);

      setAuthAvailable(available);
      setTokenPresent(has);
      if (has) {
        setAuthError(null);
      }
    } catch (error) {
      setTokenPresent(false);
      setAuthError(
        error instanceof Error
          ? error.message
          : strings.settings.repository.auth.errors.readState,
      );
    } finally {
      setCheckingToken(false);
    }
  }, [credentialId, strings.settings.repository.auth.errors.readState]);

  useEffect(() => {
    void checkToken();
  }, [checkToken]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const signIn = useCallback(async () => {
    setAuthError(null);

    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;

    try {
      const payload = await beginGitHubDeviceAuth(credentialId);
      if (abort.signal.aborted) {
        return;
      }

      setUserCode(payload.userCode);
      setPolling(true);
      await openGitHubDeviceAuth(payload);

      const result = await waitForGitHubDeviceAuth(credentialId, {
        signal: abort.signal,
      });

      if (abort.signal.aborted) {
        return;
      }

      if (result.status === 'complete') {
        setTokenPresent(true);
        setAuthError(null);
      } else {
        setAuthError(result.error);
      }
    } catch (e) {
      if (abort.signal.aborted) {
        return;
      }
      setAuthError(
        e instanceof Error
          ? e.message
          : strings.settings.repository.auth.errors.signIn,
      );
    } finally {
      if (!abort.signal.aborted) {
        setPolling(false);
        setUserCode(null);
      }
    }
  }, [credentialId, strings.settings.repository.auth.errors.signIn]);

  const cancelAuth = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPolling(false);
    setUserCode(null);
    try {
      await cancelGitHubDeviceAuth(credentialId);
    } catch {
      // best-effort cancel
    }
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
    polling,
    userCode,
    authError,
    signIn,
    cancelAuth,
    signOut,
  };
}
