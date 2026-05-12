import {
  beginGoogleDriveDeviceAuth,
  cancelGoogleDriveDeviceAuth,
  clearGoogleDriveCredentials,
  hasGoogleDriveCredentials,
  isGoogleDriveDeviceAuthAvailable,
  openGoogleDriveDeviceAuth,
  waitForGoogleDriveDeviceAuth,
} from '@/lib/sync';
import { type DeviceAuthState, useDeviceAuth } from './use-device-auth';

export type GoogleDriveAuthState = DeviceAuthState;

export function useGoogleDriveAuth(credentialId: string): GoogleDriveAuthState {
  return useDeviceAuth('GoogleDrive', credentialId, {
    isAvailable: isGoogleDriveDeviceAuthAvailable,
    hasToken: hasGoogleDriveCredentials,
    begin: beginGoogleDriveDeviceAuth,
    open: openGoogleDriveDeviceAuth,
    waitFor: (id, options) =>
      waitForGoogleDriveDeviceAuth(id, { signal: options.signal }),
    cancel: cancelGoogleDriveDeviceAuth,
    clear: clearGoogleDriveCredentials,
  });
}
