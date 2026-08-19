import {
  beginGitHubOAuth,
  cancelGitHubOAuth,
  clearGitHubToken,
  consumeGitHubVaultDiscarded,
  type GitHubOAuthStartPayload,
  hasGitHubToken,
  isGitHubOAuthAvailable,
  openGitHubOAuth,
  waitForGitHubOAuth,
} from '@/lib/sync';
import {
  type RemoteAuthState,
  type RemoteOAuthProvider,
  useRemoteAuth,
} from './use-remote-auth';

const PROVIDER: RemoteOAuthProvider<GitHubOAuthStartPayload> = {
  name: 'GitHub',
  analyticsPrefix: 'github',
  isAuthAvailable: isGitHubOAuthAvailable,
  hasToken: hasGitHubToken,
  consumeVaultDiscarded: consumeGitHubVaultDiscarded,
  begin: beginGitHubOAuth,
  open: openGitHubOAuth,
  wait: waitForGitHubOAuth,
  cancel: cancelGitHubOAuth,
  clearToken: clearGitHubToken,
};

export type GitHubAuthState = RemoteAuthState;

export function useGitHubAuth(credentialId: string): RemoteAuthState {
  return useRemoteAuth(PROVIDER, credentialId);
}
