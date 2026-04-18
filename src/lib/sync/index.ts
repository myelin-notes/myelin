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
export type { RepositoryStatus } from './context';
export {
  RepositoryProvider,
  useRepository,
  useRepositoryStatus,
} from './context';
export type { PeerSnapshot } from './live/peer-state';
export type {
  PeerControlMessage,
  PeerMessageKind,
  PeerMode,
  SyncMessage,
  YjsUpdateMessage,
} from './live/protocol';
export { noopTransport, type Transport } from './live/transport';
export {
  type ActiveRepository,
  DEFAULT_REPOSITORY_CONFIG,
  type RepositoryConfig,
  type RepositoryLifecycle,
} from './repo/config';
export { createRepository } from './repo/factory';
export type { GitHubDeviceAuthPollResult } from './repo/github-credentials';
export {
  beginGitHubDeviceAuth,
  cancelGitHubDeviceAuth,
  clearGitHubToken,
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
  getRepositoryConfig,
  setRepositoryConfig,
  subscribeRepositoryConfig,
} from './repo/repository-settings';
export type {
  FileType,
  Repository,
  RepositoryCapabilities,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './repo/types';
export { FileTypes } from './repo/types';
export type { NoteSessionOptions } from './session';
export { NoteSession } from './session';
export type {
  NoteSessionStatus,
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from './types';
