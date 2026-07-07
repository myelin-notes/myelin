export * from '@myelin/editor/sync/live/transport';
export * from '@myelin/editor/sync/repo/file-types';
// `Repository` from the editor contract is shadowed below with the app's
// extension (adds `openSession`), so importers here keep the full contract.
export * from '@myelin/editor/sync/repo/types';
export * from '@myelin/editor/sync/types';
export {
  fetchGitHubBranches,
  fetchGitHubOrgs,
  fetchGitHubReposForOrg,
  fetchGitHubReposForUser,
  fetchGitHubUser,
  type GitHubBranch,
  type GitHubOrg,
  type GitHubRepo,
  type GitHubUser,
} from '../utils/github-api';
export { RepositoryProvider } from './context';
export { CloudflareLiveDiscoveryClient } from './live/cloudflare-discovery';
export {
  createLiveDiscoveryRecordInput,
  createLiveDiscoveryRoomId,
  getLiveDiscoveryRepositoryKey,
  LIVE_DISCOVERY_MAX_RECORDS,
  LIVE_DISCOVERY_RECORD_TTL_MS,
  type LiveDiscoveryClient,
  type LiveDiscoveryRecord,
  type LiveDiscoveryRecordInput,
  parseLiveDiscoveryRecord,
  parseLiveDiscoveryRecords,
} from './live/discovery';
export type { PeerSnapshot } from './live/peer-state';
export type {
  PeerControlMessage,
  PeerMessageKind,
  PeerMode,
  SyncMessage,
  YjsUpdateMessage,
} from './live/protocol';
export {
  type ActiveRepository,
  DEFAULT_REPOSITORY_CONFIG,
  type ReadableRepository,
  type RepositoryConfig,
  type RepositoryLifecycle,
} from './repo/config';
export { createRepository } from './repo/factory';
export type { GitHubDeviceAuthPollResult } from './repo/github-credentials';
export {
  beginGitHubDeviceAuth,
  cancelGitHubDeviceAuth,
  clearGitHubToken,
  consumeGitHubVaultDiscarded,
  hasGitHubToken,
  isGitHubDeviceAuthAvailable,
  isGitHubSecureStorageAvailable,
  openGitHubDeviceAuth,
  pollGitHubDeviceAuth,
  startGitHubDeviceAuth,
  storeGitHubToken,
  waitForGitHubDeviceAuth,
} from './repo/github-credentials';
export {
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
  REPOSITORY_SETUP_INCOMPLETE_MESSAGE,
  RepositorySetupIncompleteError,
} from './repo/readiness';
export {
  getRepositoryConfig,
  setRepositoryConfig,
  subscribeRepositoryConfig,
} from './repo/repository-settings';
export type { Repository } from './repo/types';
export type { RepositoryStatus } from './repo-context';
export { useRepository, useRepositoryStatus } from './repo-context';
export { NoteSession } from './session';
