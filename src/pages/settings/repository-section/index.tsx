import { useEffect, useState } from 'react';
import { ExternalLink, Github, HardDrive, LogOut, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TimeAgo } from '@/components/time-ago';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useStrings, type Messages } from '@/lib/i18n';
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
  const strings = useStrings();
  const locale = useLocale();
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
    ? strings.settings.repository.auth.descriptions.polling
    : auth.tokenPresent
      ? strings.settings.repository.auth.descriptions.connected
      : !auth.authAvailable
        ? strings.settings.repository.auth.descriptions.unavailable
        : strings.settings.repository.auth.descriptions.signIn;

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
  } = computeSyncStatus(strings, githubConfigReady, repositoryStatus);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">
          {strings.settings.repository.title}
        </h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.repository.eyebrow}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
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
                      {strings.settings.repository.auth.title}
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
                      {strings.settings.repository.auth.buttons.signOut}
                    </Button>
                  ) : auth.polling ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void auth.cancelAuth()}
                      className="text-text-muted"
                    >
                      <X className="size-3.5" />
                      {strings.common.cancel}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void auth.signIn()}
                      disabled={!auth.authAvailable}
                    >
                      <ExternalLink className="size-3.5" />
                      {strings.settings.repository.auth.buttons.signIn}
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

                <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg bg-white/70 px-4 py-3 ring-1 ring-border-subtle">
                  <div>
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">
                      {strings.settings.repository.sync.queuedChanges}
                    </p>
                    <p className="mt-1 font-medium text-sm text-text-primary">
                      {githubConfigReady
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
                      {githubConfigReady ? (
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

                {githubConfigReady && repositoryStatus.lastError && (
                  <p className="mt-3 rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                    {repositoryStatus.lastError.message}
                  </p>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[10px] text-text-muted uppercase tracking-widest">
                  {strings.settings.repository.sync.remoteRepository}
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
  strings: Messages,
  githubConfigReady: boolean,
  status: ReturnType<typeof useRepositoryStatus>,
): { label: string; tone: SyncStatusTone; description: string } {
  const copy = strings.settings.repository.sync.status;

  if (!githubConfigReady) {
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
