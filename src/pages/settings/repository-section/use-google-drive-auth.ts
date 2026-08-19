import {
  beginGoogleDriveAuth,
  cancelGoogleDriveAuth,
  clearGoogleDriveToken,
  consumeGoogleDriveVaultDiscarded,
  GOOGLE_DRIVE_PROVIDER_NAME,
  type GoogleDriveOAuthStartPayload,
  hasGoogleDriveToken,
  isGoogleDriveAuthAvailable,
  openGoogleDriveAuth,
  waitForGoogleDriveAuth,
} from '@/lib/sync';
import {
  type RemoteAuthState,
  type RemoteOAuthProvider,
  useRemoteAuth,
} from './use-remote-auth';

const PROVIDER: RemoteOAuthProvider<GoogleDriveOAuthStartPayload> = {
  name: GOOGLE_DRIVE_PROVIDER_NAME,
  analyticsPrefix: 'google_drive',
  isAuthAvailable: isGoogleDriveAuthAvailable,
  hasToken: hasGoogleDriveToken,
  consumeVaultDiscarded: consumeGoogleDriveVaultDiscarded,
  begin: beginGoogleDriveAuth,
  open: openGoogleDriveAuth,
  wait: waitForGoogleDriveAuth,
  cancel: cancelGoogleDriveAuth,
  clearToken: clearGoogleDriveToken,
};

export function useGoogleDriveAuth(credentialId: string): RemoteAuthState {
  return useRemoteAuth(PROVIDER, credentialId);
}
