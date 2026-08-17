import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  cancelGoogleDriveAuth,
  clearGoogleDriveToken,
  consumeGoogleDriveVaultDiscarded,
  hasGoogleDriveToken,
  isGoogleDriveAuthAvailable,
  startGoogleDriveAuth,
} from '@/lib/sync';
import type { DeviceAuthState } from './use-device-auth';

const PROVIDER_NAME = 'Google Drive';
const logger = new Logger('GoogleDriveAuth');

/**
 * Sign-in state for the Google Drive backend. Deliberately not `useDeviceAuth`:
 * that hook is built around a user code and a polling loop, and the PKCE
 * authorization code flow has neither — the browser redirects straight back to
 * a loopback listener. `userCode` is always null so the shared settings UI can
 * treat both providers alike.
 */
export function useGoogleDriveAuth(credentialId: string): DeviceAuthState {
  const strings = useMessages();
  const [tokenPresent, setTokenPresent] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [authAvailable, setAuthAvailable] = useState(true);
  const [polling, setPolling] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const [available, has] = await Promise.all([
        isGoogleDriveAuthAvailable(),
        hasGoogleDriveToken(credentialId),
      ]);

      setAuthAvailable(available);
      setTokenPresent(has);
      if (has) {
        setAuthError(null);
      }
      if (consumeGoogleDriveVaultDiscarded()) {
        toast.warning(
          strings.settings.repository.auth.notices.credentialReset(
            PROVIDER_NAME,
          ),
        );
      }
    } catch (error) {
      logger.error('Failed to read Google Drive auth state', error, {
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

    setPolling(true);
    try {
      await startGoogleDriveAuth(credentialId, { signal: abort.signal });
      if (abort.signal.aborted) {
        return;
      }
      setTokenPresent(true);
      trackEvent('google_drive_auth_completed', {
        credential_id: credentialId,
      });
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      logger.error('Google Drive sign-in failed', error, { credentialId });
      trackEvent('google_drive_auth_failed', {
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
        setPolling(false);
      }
    }
  }, [credentialId, strings.settings.repository.auth.errors.signIn]);

  const cancelAuth = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPolling(false);
    await cancelGoogleDriveAuth().catch(() => {
      // best-effort cancel
    });
  }, []);

  const signOut = useCallback(async () => {
    await clearGoogleDriveToken(credentialId);
    setTokenPresent(false);
    setAuthError(null);
  }, [credentialId]);

  return {
    tokenPresent,
    checkingToken,
    authAvailable,
    polling,
    userCode: null,
    authError,
    signIn,
    cancelAuth,
    signOut,
  };
}
