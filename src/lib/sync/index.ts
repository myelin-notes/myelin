export * from '@myelin/editor/sync/live/transport';
export * from '@myelin/editor/sync/repo/file-types';
export * from '@myelin/editor/sync/repo/types';
export * from '@myelin/editor/sync/types';
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
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  DEFAULT_REPOSITORY_CONFIG,
  type ReadableRepository,
  type RepositoryConfig,
} from './repo/config';
export { createRepository } from './repo/factory';
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
} from './repo/github/api';
export type {
  GitHubOAuthResult,
  GitHubOAuthStartPayload,
} from './repo/github/credentials';
export {
  beginGitHubOAuth,
  cancelGitHubOAuth,
  clearGitHubToken,
  consumeGitHubVaultDiscarded,
  hasGitHubToken,
  isGitHubOAuthAvailable,
  isGitHubSecureStorageAvailable,
  openGitHubOAuth,
  storeGitHubToken,
  waitForGitHubOAuth,
} from './repo/github/credentials';
export type {
  GoogleDriveOAuthResult,
  GoogleDriveOAuthStartPayload,
} from './repo/google-drive/credentials';
export {
  beginGoogleDriveAuth,
  cancelGoogleDriveAuth,
  clearGoogleDriveToken,
  consumeGoogleDriveVaultDiscarded,
  GOOGLE_DRIVE_PROVIDER_NAME,
  hasGoogleDriveToken,
  isGoogleDriveAuthAvailable,
  isGoogleDriveSecureStorageAvailable,
  openGoogleDriveAuth,
  waitForGoogleDriveAuth,
} from './repo/google-drive/credentials';
export {
  ensureGoogleDriveFolder,
  renameGoogleDriveFolder,
} from './repo/google-drive/folders';
export { NativeRepository } from './repo/native';
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
export type { RepositoryStatus } from './repo-context';
export { useRepository, useRepositoryStatus } from './repo-context';
export { NoteSession } from './session';
