import { useEffect, useEffectEvent, useState } from 'react';
import {
  Cloud,
  ExternalLink,
  Github,
  HardDrive,
  LogOut,
  X,
} from 'lucide-react';
import { formatNumber } from '@myelin/editor/i18n/format';
import { TimeAgo } from '@/components/time-ago';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { type Messages, useLocale, useMessages } from '@/lib/i18n';
import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  GOOGLE_DRIVE_PROVIDER_NAME,
  getRepositoryConfig,
  type RepositoryConfig,
  type RepositoryStatus,
  setRepositoryConfig,
  subscribeRepositoryConfig,
  useRepositoryStatus,
} from '@/lib/sync';
import { cn } from '@/lib/utils';
import { AuthStatusBadge } from './auth-status-badge';
import { BranchField } from './branch-field';
import { FolderField } from './folder-field';
import { KindCard } from './kind-card';
import { OwnerField } from './owner-field';
import { RepoField } from './repo-field';
import { SyncStatusBadge, type SyncStatusTone } from './sync-status-badge';
import { useGitHubAuth } from './use-github-auth';
import { useGitHubSelectors } from './use-github-selectors';
import { useGoogleDriveAuth } from './use-google-drive-auth';
import { useGoogleDriveFolder } from './use-google-drive-folder';

type RepoKind = RepositoryConfig['kind'];

/**
 * Repository picker and remote connection flow, without the surrounding section
 * heading. Shared by the Settings sync section and the first-run onboarding
 * step so both drive the same config through the same code path.
 *
 * `onSetupCompleteChange` reports whether the chosen repository is actually
 * usable — always true for a local one, true for GitHub only once it is signed
 * in with an owner, repo, and branch picked, and true for Google Drive once it
 * is signed in with a folder resolved. Onboarding gates its Continue button on
 * it so nobody leaves the step half-connected.
 */
export function RepositorySetup({
  onSetupCompleteChange,
}: {
  onSetupCompleteChange?: (complete: boolean) => void;
} = {}) {
  const strings = useMessages();
  const locale = useLocale();
  const [config, setConfig] = useState<RepositoryConfig>(getRepositoryConfig);
  const repositoryStatus = useRepositoryStatus();

  useEffect(() => {
    return subscribeRepositoryConfig(setConfig);
  }, []);

  const githubCredentialId =
    config.kind === 'github'
      ? config.credentialId.trim() || 'default'
      : 'default';
  const githubAuth = useGitHubAuth(githubCredentialId);
  const selectors = useGitHubSelectors({
    tokenPresent: githubAuth.tokenPresent,
    credentialId: githubCredentialId,
    config,
  });

  const googleDriveCredentialId =
    config.kind === 'google-drive'
      ? config.credentialId.trim() || 'default'
      : 'default';
  const googleDriveAuth = useGoogleDriveAuth(googleDriveCredentialId);
  const driveFolder = useGoogleDriveFolder({
    config,
    tokenPresent: googleDriveAuth.tokenPresent,
  });

  const isDrive = config.kind === 'google-drive';
  const remoteAuth = isDrive ? googleDriveAuth : githubAuth;
  const remoteProviderName = isDrive ? GOOGLE_DRIVE_PROVIDER_NAME : 'GitHub';
  const RemoteAuthIcon = isDrive ? Cloud : Github;

  const handleKindChange = (kind: RepoKind) => {
    if (kind !== config.kind) {
      trackEvent('sync_mode_changed', {
        new_kind: kind,
        previous_kind: config.kind,
      });
    }

    if (kind === 'local') {
      setRepositoryConfig({ kind: 'local' });
      return;
    }

    if (kind === 'github') {
      setRepositoryConfig({
        kind: 'github',
        owner: config.kind === 'github' ? config.owner : '',
        repo: config.kind === 'github' ? config.repo : '',
        branch: config.kind === 'github' ? config.branch : 'main',
        credentialId: config.kind === 'github' ? githubCredentialId : 'default',
      });
      return;
    }

    if (kind === 'google-drive') {
      setRepositoryConfig({
        kind: 'google-drive',
        folderName:
          config.kind === 'google-drive'
            ? config.folderName
            : DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
        folderId: config.kind === 'google-drive' ? config.folderId : '',
        credentialId:
          config.kind === 'google-drive' ? googleDriveCredentialId : 'default',
      });
      return;
    }
  };

  const handleOwnerChange = (owner: string) => {
    if (config.kind !== 'github' || owner === config.owner) {
      return;
    }
    setRepositoryConfig({
      ...config,
      owner,
      repo: '',
      branch: 'main',
    });
  };

  const handleRepoChange = (repoName: string) => {
    if (config.kind !== 'github' || repoName === config.repo) {
      return;
    }
    const selected = selectors.repos.find((repo) => repo.name === repoName);
    setRepositoryConfig({
      ...config,
      repo: repoName,
      branch: selected?.defaultBranch || config.branch || 'main',
    });
  };

  const handleBranchChange = (branch: string) => {
    if (config.kind !== 'github' || branch === (config.branch ?? '')) {
      return;
    }
    setRepositoryConfig({ ...config, branch });
  };

  const authDescription = remoteAuth.awaitingRedirect
    ? strings.settings.repository.auth.descriptions.awaitingRedirect(
        remoteProviderName,
      )
    : remoteAuth.tokenPresent
      ? strings.settings.repository.auth.descriptions.connected
      : !remoteAuth.authAvailable
        ? strings.settings.repository.auth.descriptions.unavailable
        : strings.settings.repository.auth.descriptions.signIn;

  const githubConfigReady =
    config.kind === 'github' &&
    Boolean(config.owner.trim()) &&
    Boolean(config.repo.trim()) &&
    Boolean((config.branch ?? '').trim()) &&
    githubAuth.tokenPresent;
  const googleDriveConfigReady =
    config.kind === 'google-drive' &&
    Boolean(config.folderName.trim()) &&
    Boolean(config.folderId.trim()) &&
    googleDriveAuth.tokenPresent;
  const remoteConfigReady = githubConfigReady || googleDriveConfigReady;
  const setupComplete = config.kind === 'local' || remoteConfigReady;

  const notifySetupComplete = useEffectEvent((complete: boolean) => {
    onSetupCompleteChange?.(complete);
  });
  useEffect(() => {
    notifySetupComplete(setupComplete);
  }, [setupComplete]);

  const {
    label: syncBadgeLabel,
    tone: syncBadgeTone,
    description: syncDescription,
  } = computeSyncStatus(strings, remoteConfigReady, repositoryStatus);

  return (
    <>
      <div className="divide-y divide-border-divider/60 overflow-hidden rounded-xl bg-input/40 ring-1 ring-border-subtle/70">
        <KindCard
          selected={config.kind === 'local'}
          onSelect={() => handleKindChange('local')}
          icon={HardDrive}
          label={strings.settings.repository.kinds.local.label}
          description={strings.settings.repository.kinds.local.description}
        />
        <KindCard
          selected={config.kind === 'github'}
          onSelect={() => handleKindChange('github')}
          icon={Github}
          label={strings.settings.repository.kinds.github.label}
          description={strings.settings.repository.kinds.github.description}
        />
        <KindCard
          selected={config.kind === 'google-drive'}
          onSelect={() => handleKindChange('google-drive')}
          icon={Cloud}
          label={strings.settings.repository.kinds.googleDrive.label}
          description={
            strings.settings.repository.kinds.googleDrive.description
          }
        />
      </div>

      <div
        className={cn(
          'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          config.kind !== 'local' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0">
          <div className="mt-5 space-y-4">
            {!remoteAuth.tokenPresent ? (
              <>
                <div className="flex flex-col gap-3 rounded-xl bg-input/40 px-5 py-4 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <RemoteAuthIcon className="size-5 shrink-0 text-text-secondary" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-text-primary">
                        {strings.settings.repository.auth.title}
                      </p>
                      <p className="mt-0.5 text-text-muted text-xs">
                        {authDescription}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                    {remoteAuth.awaitingRedirect ? (
                      <>
                        <AuthStatusBadge
                          hasToken={false}
                          checking={false}
                          authorizing
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void remoteAuth.cancelAuth()}
                          className="text-text-muted"
                        >
                          <X className="size-3.5" />
                          {strings.common.cancel}
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() => void remoteAuth.signIn()}
                        disabled={!remoteAuth.authAvailable}
                      >
                        <ExternalLink className="size-3.5" />
                        {strings.settings.repository.auth.buttons.signIn}
                      </Button>
                    )}
                  </div>
                </div>

                {remoteAuth.authError && (
                  <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                    {remoteAuth.authError}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col gap-3 rounded-xl bg-input/40 px-5 py-4 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <RemoteAuthIcon className="size-5 shrink-0 text-text-secondary" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-text-primary">
                        {strings.settings.repository.auth.title}
                      </p>
                      <p className="mt-0.5 text-text-muted text-xs">
                        {authDescription}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                    <AuthStatusBadge
                      hasToken={remoteAuth.tokenPresent}
                      checking={remoteAuth.checkingToken}
                      authorizing={remoteAuth.awaitingRedirect}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void remoteAuth.signOut()}
                      className="text-text-muted hover:text-destructive"
                    >
                      <LogOut className="size-3.5" />
                      {strings.settings.repository.auth.buttons.signOut}
                    </Button>
                  </div>
                </div>

                {remoteAuth.authError && (
                  <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                    {remoteAuth.authError}
                  </p>
                )}

                {config.kind === 'github' && (
                  <>
                    <div>
                      <p className="mb-1.5 text-[10px] text-text-muted uppercase tracking-widest">
                        {strings.settings.repository.sync.remoteRepository}
                      </p>
                      <div className="flex flex-wrap items-center gap-0.5 rounded-xl bg-input/40 p-1 ring-1 ring-border-subtle/70 sm:flex-nowrap">
                        <OwnerField
                          disabled={!githubAuth.tokenPresent}
                          loading={selectors.ownersLoading}
                          user={selectors.user}
                          orgs={selectors.orgs}
                          value={config.owner}
                          onChange={handleOwnerChange}
                          className="min-w-0 flex-1"
                        />
                        <PathDivider>/</PathDivider>
                        <RepoField
                          disabled={
                            !githubAuth.tokenPresent || !config.owner.trim()
                          }
                          loading={selectors.reposLoading}
                          repos={selectors.repos}
                          value={config.repo}
                          onChange={handleRepoChange}
                          className="min-w-0 flex-1"
                        />
                        <PathDivider>@</PathDivider>
                        <BranchField
                          disabled={
                            !githubAuth.tokenPresent || !config.repo.trim()
                          }
                          loading={selectors.branchesLoading}
                          branches={selectors.branches}
                          value={config.branch ?? ''}
                          onChange={handleBranchChange}
                          className="min-w-0 flex-1"
                        />
                      </div>
                    </div>

                    {selectors.error && (
                      <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                        {selectors.error}
                      </p>
                    )}
                  </>
                )}

                {config.kind === 'google-drive' && (
                  <>
                    <div>
                      <p className="mb-1.5 text-[10px] text-text-muted uppercase tracking-widest">
                        {strings.settings.repository.sync.driveFolder}
                      </p>
                      <div className="rounded-xl bg-input/40 p-2 ring-1 ring-border-subtle/70">
                        <FolderField
                          value={config.folderName}
                          disabled={!googleDriveAuth.tokenPresent}
                          resolving={driveFolder.resolving}
                          onCommit={driveFolder.setFolderName}
                        />
                      </div>
                    </div>

                    {driveFolder.error && (
                      <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                        {driveFolder.error}
                      </p>
                    )}
                  </>
                )}

                <div className="rounded-xl bg-input/40 px-5 py-4 ring-1 ring-border-subtle/70">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm text-text-primary">
                        {strings.settings.repository.sync.title}
                      </p>
                      <p className="mt-0.5 text-text-muted text-xs">
                        {syncDescription}
                      </p>
                    </div>
                    <SyncStatusBadge
                      label={syncBadgeLabel}
                      tone={syncBadgeTone}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg bg-card/70 px-4 py-3 ring-1 ring-border-ghost sm:grid-cols-2 sm:gap-4">
                    <div>
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">
                        {strings.settings.repository.sync.queuedChanges}
                      </p>
                      <p className="mt-1 font-medium text-sm text-text-primary">
                        {remoteConfigReady
                          ? formatNumber(
                              repositoryStatus.pendingRemoteWrites,
                              locale,
                            )
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">
                        {strings.settings.repository.sync.lastSync}
                      </p>
                      <p className="mt-1 font-medium text-sm text-text-primary">
                        {remoteConfigReady ? (
                          repositoryStatus.lastRemoteSyncAt ? (
                            <TimeAgo date={repositoryStatus.lastRemoteSyncAt} />
                          ) : (
                            strings.common.never
                          )
                        ) : (
                          '—'
                        )}
                      </p>
                    </div>
                  </div>

                  {remoteConfigReady && repositoryStatus.lastError && (
                    <p className="mt-3 rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                      {repositoryStatus.lastError.message}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function PathDivider({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none select-none font-heading font-light text-lg text-text-muted/60 tabular-nums leading-none"
    >
      {children}
    </span>
  );
}

function computeSyncStatus(
  strings: Messages,
  remoteConfigReady: boolean,
  status: RepositoryStatus,
): { label: string; tone: SyncStatusTone; description: string } {
  const copy = strings.settings.repository.sync.status;

  if (!remoteConfigReady) {
    return {
      label: copy.setupRequired.label,
      tone: 'neutral',
      description: copy.setupRequired.description,
    };
  }

  if (status.initializing) {
    return {
      label: copy.loading.label,
      tone: 'neutral',
      description: copy.loading.description,
    };
  }

  if (status.pendingRemoteWrites > 0) {
    return {
      label: copy.pending.label,
      tone: 'neutral',
      description: copy.pending.description(
        status.pendingRemoteWrites,
        status.online,
      ),
    };
  }

  if (!status.online || status.lastError) {
    return {
      label: copy.issue.label,
      tone: 'danger',
      description: status.online
        ? copy.issue.onlineDescription
        : copy.issue.offlineDescription,
    };
  }

  return {
    label: copy.synced.label,
    tone: 'success',
    description: status.lastRemoteSyncAt
      ? copy.synced.upToDate
      : copy.synced.ready,
  };
}
