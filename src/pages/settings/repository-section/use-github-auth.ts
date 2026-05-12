import {
  beginGitHubDeviceAuth,
  cancelGitHubDeviceAuth,
  clearGitHubToken,
  hasGitHubToken,
  isGitHubDeviceAuthAvailable,
  openGitHubDeviceAuth,
  waitForGitHubDeviceAuth,
} from '@/lib/sync';
import { type DeviceAuthState, useDeviceAuth } from './use-device-auth';

export type GitHubAuthState = DeviceAuthState;

export function useGitHubAuth(credentialId: string): GitHubAuthState {
  return useDeviceAuth('GitHub', credentialId, {
    isAvailable: isGitHubDeviceAuthAvailable,
    hasToken: hasGitHubToken,
    begin: beginGitHubDeviceAuth,
    open: openGitHubDeviceAuth,
    waitFor: (id, options) =>
      waitForGitHubDeviceAuth(id, { signal: options.signal }),
    cancel: cancelGitHubDeviceAuth,
    clear: clearGitHubToken,
  });
}
