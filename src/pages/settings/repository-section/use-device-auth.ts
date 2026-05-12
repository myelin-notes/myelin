import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';

export interface DeviceAuthBeginPayload {
  userCode: string;
}

export type DeviceAuthWaitResult =
  | { status: 'complete' }
  | { status: 'failed'; error: string };

export interface DeviceAuthApi<TBegin extends DeviceAuthBeginPayload> {
  isAvailable: () => Promise<boolean>;
  hasToken: (credentialId: string) => Promise<boolean>;
  begin: (credentialId: string) => Promise<TBegin>;
  open: (payload: TBegin) => Promise<void>;
  waitFor: (
    credentialId: string,
    options: { signal: AbortSignal },
  ) => Promise<DeviceAuthWaitResult>;
  cancel: (credentialId: string) => Promise<void>;
  clear: (credentialId: string) => Promise<void>;
}

export interface DeviceAuthState {
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

export function useDeviceAuth<TBegin extends DeviceAuthBeginPayload>(
  providerName: string,
  credentialId: string,
  api: DeviceAuthApi<TBegin>,
): DeviceAuthState {
  const strings = useMessages();
  const [tokenPresent, setTokenPresent] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [authAvailable, setAuthAvailable] = useState(true);
  const [polling, setPolling] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const loggerRef = useRef(new Logger(`DeviceAuth:${providerName}`));
  const apiRef = useRef(api);
  apiRef.current = api;

  const abortRef = useRef<AbortController | null>(null);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const [available, has] = await Promise.all([
        apiRef.current.isAvailable(),
        apiRef.current.hasToken(credentialId),
      ]);

      setAuthAvailable(available);
      setTokenPresent(has);
      if (has) {
        setAuthError(null);
      }
    } catch (error) {
      loggerRef.current.error('Failed to read device auth state', error, {
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
      const payload = await apiRef.current.begin(credentialId);
      if (abort.signal.aborted) {
        return;
      }

      setUserCode(payload.userCode);
      setPolling(true);
      await apiRef.current.open(payload);

      const result = await apiRef.current.waitFor(credentialId, {
        signal: abort.signal,
      });

      if (abort.signal.aborted) {
        return;
      }

      if (result.status === 'complete') {
        setTokenPresent(true);
        setAuthError(null);
      } else {
        loggerRef.current.error('Device auth flow failed', undefined, {
          credentialId,
          reason: result.error,
        });
        setAuthError(result.error);
      }
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      loggerRef.current.error('Device auth sign-in threw', error, {
        credentialId,
      });
      setAuthError(
        error instanceof Error
          ? error.message
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
      await apiRef.current.cancel(credentialId);
    } catch {
      // best-effort cancel
    }
  }, [credentialId]);

  const signOut = useCallback(async () => {
    await apiRef.current.clear(credentialId);
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
