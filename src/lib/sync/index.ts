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
  useVersionStore,
} from './context';
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
export {
  getFileTypeForName,
  getMimeTypeForFileType,
  isImageFileType,
} from './repo/shared';
export type {
  FileType,
  NoteBacklink,
  Repository,
  RepositoryCapabilities,
  RepositoryStats,
  RepositoryTag,
  StoredNoteLink,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './repo/types';
export { FileTypes, ImageFileTypes, VideoFileTypes } from './repo/types';
export { NoteSession } from './session';
export type {
  NoteSessionStatus,
  VFSNodeId,
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from './types';
export { type VersionEntry, VersionStore } from './versions';
