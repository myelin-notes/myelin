import { useEffect, useState } from 'react';
import { ExternalLink, Github, HardDrive, LogOut, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TimeAgo } from '@/components/time-ago';
import { Button } from '@/components/ui/button';
import {
  getRepositoryConfig,
  type RepositoryConfig,
  setRepositoryConfig,
  subscribeRepositoryConfig,
  useRepositoryStatus,
} from '@/lib/sync';
import { AuthStatusBadge } from './auth-status-badge';
import { BranchField } from './branch-field';
import { DeviceCodeDisplay } from './device-code-display';
import { KindCard } from './kind-card';
import { OwnerField } from './owner-field';
import { RepoField } from './repo-field';
import { SyncStatusBadge, type SyncStatusTone } from './sync-status-badge';
import { useGitHubAuth } from './use-github-auth';
import { useGitHubSelectors } from './use-github-selectors';

type RepoKind = RepositoryConfig['kind'];

export function RepositorySection() {
  const [config, setConfig] = useState<RepositoryConfig>(getRepositoryConfig);
  const repositoryStatus = useRepositoryStatus();

  useEffect(() => {
    return subscribeRepositoryConfig(setConfig);
  }, []);

  const credentialId =
    config.kind === 'github'
      ? config.credentialId.trim() || 'default'
      : 'default';

  const auth = useGitHubAuth(credentialId);
  const selectors = useGitHubSelectors({
    tokenPresent: auth.tokenPresent,
    credentialId,
    config,
  });

  const handleKindChange = (kind: RepoKind) => {
    if (kind === 'local') {
      setRepositoryConfig({ kind: 'local' });
    } else {
      setRepositoryConfig({
        kind: 'github',
        owner: config.kind === 'github' ? config.owner : '',
        repo: config.kind === 'github' ? config.repo : '',
        branch: config.kind === 'github' ? config.branch : 'main',
        credentialId,
      });
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
    const selected = selectors.repos.find((r) => r.name === repoName);
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

  const authDescription = auth.polling
    ? 'Enter the code on GitHub to finish signing in'
    : auth.tokenPresent
      ? 'Signed in via GitHub'
      : !auth.authAvailable
        ? 'GitHub authentication is unavailable'
        : 'Sign in with your GitHub account';

  const githubConfigReady =
    config.kind === 'github' &&
    Boolean(config.owner.trim()) &&
    Boolean(config.repo.trim()) &&
    Boolean((config.branch ?? '').trim()) &&
    auth.tokenPresent;

  const {
    label: syncBadgeLabel,
    tone: syncBadgeTone,
    description: syncDescription,
  } = computeSyncStatus(githubConfigReady, repositoryStatus);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">Repository</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          Sync
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KindCard
          selected={config.kind === 'local'}
          onSelect={() => handleKindChange('local')}
          icon={HardDrive}
          label="Local"
          description="Notes stored on this device only"
        />
        <KindCard
          selected={config.kind === 'github'}
          onSelect={() => handleKindChange('github')}
          icon={Github}
          label="GitHub"
          description="Sync to a private GitHub repository"
        />
      </div>

      <AnimatePresence initial={false}>
        {config.kind === 'github' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-input px-5 py-4">
                <div className="flex items-center gap-3">
                  <Github className="size-5 text-text-secondary" />
                  <div>
                    <p className="font-medium text-sm text-text-primary">
                      GitHub Authentication
                    </p>
                    <p className="mt-0.5 text-text-muted text-xs">
                      {authDescription}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <AuthStatusBadge
                    hasToken={auth.tokenPresent}
                    checking={auth.checkingToken}
                    polling={auth.polling}
                  />
                  {auth.tokenPresent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void auth.signOut()}
                      className="text-text-muted hover:text-destructive"
                    >
                      <LogOut className="size-3.5" />
                      Sign out
                    </Button>
                  ) : auth.polling ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void auth.cancelAuth()}
                      className="text-text-muted"
                    >
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void auth.signIn()}
                      disabled={!auth.authAvailable}
                    >
                      <ExternalLink className="size-3.5" />
                      Sign in
                    </Button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {auth.userCode && (
                  <DeviceCodeDisplay
                    userCode={auth.userCode}
                    onCopy={() => {}}
                  />
                )}
              </AnimatePresence>

              {auth.authError && (
                <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                  {auth.authError}
                </p>
              )}

              <div className="rounded-xl bg-input px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm text-text-primary">
                      Repository Sync
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

                <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg bg-white/70 px-4 py-3 ring-1 ring-border-subtle">
                  <div>
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">
                      Queued changes
                    </p>
                    <p className="mt-1 font-medium text-sm text-text-primary">
                      {githubConfigReady
                        ? repositoryStatus.pendingRemoteWrites
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">
                      Last sync
                    </p>
                    <p className="mt-1 font-medium text-sm text-text-primary">
                      {githubConfigReady ? (
                        repositoryStatus.lastRemoteSyncAt ? (
                          <TimeAgo date={repositoryStatus.lastRemoteSyncAt} />
                        ) : (
                          'Never'
                        )
                      ) : (
                        '—'
                      )}
                    </p>
                  </div>
                </div>

                {githubConfigReady && repositoryStatus.lastError && (
                  <p className="mt-3 rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                    {repositoryStatus.lastError.message}
                  </p>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[10px] text-text-muted uppercase tracking-widest">
                  Remote Repository
                </p>
                <div className="flex items-center gap-0.5 rounded-xl bg-input p-1">
                  <OwnerField
                    disabled={!auth.tokenPresent}
                    loading={selectors.ownersLoading}
                    user={selectors.user}
                    orgs={selectors.orgs}
                    value={config.owner}
                    onChange={handleOwnerChange}
                    className="min-w-0 flex-1"
                  />
                  <PathDivider>/</PathDivider>
                  <RepoField
                    disabled={!auth.tokenPresent || !config.owner.trim()}
                    loading={selectors.reposLoading}
                    repos={selectors.repos}
                    value={config.repo}
                    onChange={handleRepoChange}
                    className="min-w-0 flex-1"
                  />
                  <PathDivider>@</PathDivider>
                  <BranchField
                    disabled={!auth.tokenPresent || !config.repo.trim()}
                    loading={selectors.branchesLoading}
                    branches={selectors.branches}
                    value={config.branch ?? ''}
                    onChange={handleBranchChange}
                    className="min-w-0 flex-1"
                  />
                </div>
              </div>

              {(selectors.ownersError ||
                selectors.reposError ||
                selectors.branchesError) && (
                <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                  {selectors.ownersError ??
                    selectors.reposError ??
                    selectors.branchesError}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
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
  githubConfigReady: boolean,
  status: ReturnType<typeof useRepositoryStatus>,
): { label: string; tone: SyncStatusTone; description: string } {
  if (!githubConfigReady) {
    return {
      label: 'Setup required',
      tone: 'neutral',
      description: 'Sign in and choose a repository to enable sync.',
    };
  }

  if (status.initializing) {
    return {
      label: 'Loading',
      tone: 'neutral',
      description: 'Loading the cached repository and checking the remote.',
    };
  }

  if (status.pendingRemoteWrites > 0) {
    const plural = status.pendingRemoteWrites === 1 ? '' : 's';
    return {
      label: 'Pending',
      tone: 'neutral',
      description: status.online
        ? `${status.pendingRemoteWrites} change${plural} queued for upload.`
        : `${status.pendingRemoteWrites} change${plural} queued locally until remote sync recovers.`,
    };
  }

  if (!status.online || status.lastError) {
    return {
      label: 'Issue',
      tone: 'danger',
      description: status.online
        ? 'The repository is configured, but the last sync attempt failed.'
        : 'Remote sync is unavailable. Cached data remains available locally.',
    };
  }

  return {
    label: 'Synced',
    tone: 'success',
    description: status.lastRemoteSyncAt
      ? 'Remote repository is up to date.'
      : 'Repository is ready to sync.',
  };
}
