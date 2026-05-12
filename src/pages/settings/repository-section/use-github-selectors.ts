import { useEffect, useState } from 'react';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  fetchGitHubBranches,
  fetchGitHubOrgs,
  fetchGitHubReposForOrg,
  fetchGitHubReposForUser,
  fetchGitHubUser,
  type GitHubBranch,
  type GitHubOrg,
  type GitHubRepo,
  type GitHubUser,
  type RepositoryConfig,
  setRepositoryConfig,
} from '@/lib/sync';

const logger = new Logger('GitHubSelectors');

export interface GitHubSelectorsState {
  user: GitHubUser | null;
  orgs: GitHubOrg[];
  repos: GitHubRepo[];
  branches: GitHubBranch[];
  ownersLoading: boolean;
  reposLoading: boolean;
  branchesLoading: boolean;
  error: string | null;
}

export function useGitHubSelectors({
  tokenPresent,
  credentialId,
  config,
}: {
  tokenPresent: boolean;
  credentialId: string;
  config: RepositoryConfig;
}): GitHubSelectorsState {
  const strings = useMessages();
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [orgs, setOrgs] = useState<GitHubOrg[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [reposLoading, setReposLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owner = config.kind === 'github' ? config.owner : '';
  const repo = config.kind === 'github' ? config.repo : '';

  useEffect(() => {
    if (!tokenPresent || config.kind !== 'github') {
      setUser(null);
      setOrgs([]);
      setError(null);
      return;
    }

    const abort = new AbortController();
    setOwnersLoading(true);
    setError(null);

    void (async () => {
      try {
        const [fetchedUser, fetchedOrgs] = await Promise.all([
          fetchGitHubUser(credentialId, abort.signal),
          fetchGitHubOrgs(credentialId, abort.signal).catch(
            () => [] as GitHubOrg[],
          ),
        ]);
        if (abort.signal.aborted) {
          return;
        }
        setUser(fetchedUser);
        setOrgs(fetchedOrgs);
      } catch (error) {
        if (!abort.signal.aborted) {
          logger.error('Failed to load GitHub owners', error);
          setError(
            error instanceof Error
              ? error.message
              : strings.settings.repository.fields.owner.error,
          );
        }
      } finally {
        if (!abort.signal.aborted) {
          setOwnersLoading(false);
        }
      }
    })();

    return () => {
      abort.abort();
    };
  }, [
    config.kind,
    credentialId,
    strings.settings.repository.fields.owner.error,
    tokenPresent,
  ]);

  useEffect(() => {
    if (!tokenPresent || config.kind !== 'github' || !user || !owner.trim()) {
      setRepos([]);
      return;
    }

    const ownerName = owner.trim();
    const abort = new AbortController();
    setReposLoading(true);
    setError(null);

    void (async () => {
      try {
        const isUser = ownerName === user.login;
        const list = isUser
          ? await fetchGitHubReposForUser(credentialId, abort.signal)
          : await fetchGitHubReposForOrg(credentialId, ownerName, abort.signal);
        if (!abort.signal.aborted) {
          setRepos(list);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          logger.error('Failed to load GitHub repos', error, {
            owner: ownerName,
          });
          setError(
            error instanceof Error
              ? error.message
              : strings.settings.repository.fields.repo.error,
          );
        }
      } finally {
        if (!abort.signal.aborted) {
          setReposLoading(false);
        }
      }
    })();

    return () => {
      abort.abort();
    };
  }, [
    config.kind,
    credentialId,
    owner,
    strings.settings.repository.fields.repo.error,
    tokenPresent,
    user,
  ]);

  useEffect(() => {
    if (
      !tokenPresent ||
      config.kind !== 'github' ||
      !owner.trim() ||
      !repo.trim()
    ) {
      setBranches([]);
      return;
    }

    const ownerName = owner.trim();
    const repoName = repo.trim();
    const abort = new AbortController();
    setBranchesLoading(true);
    setError(null);

    void (async () => {
      try {
        const list = await fetchGitHubBranches(
          credentialId,
          ownerName,
          repoName,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setBranches(list);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          logger.error('Failed to load GitHub branches', error, {
            owner: ownerName,
            repo: repoName,
          });
          setError(
            error instanceof Error
              ? error.message
              : strings.settings.repository.fields.branch.error,
          );
        }
      } finally {
        if (!abort.signal.aborted) {
          setBranchesLoading(false);
        }
      }
    })();

    return () => {
      abort.abort();
    };
  }, [
    config.kind,
    credentialId,
    owner,
    repo,
    strings.settings.repository.fields.branch.error,
    tokenPresent,
  ]);

  useEffect(() => {
    if (config.kind !== 'github' || !user || config.owner.trim().length > 0) {
      return;
    }
    setRepositoryConfig({ ...config, owner: user.login });
  }, [config, user]);

  return {
    user,
    orgs,
    repos,
    branches,
    ownersLoading,
    reposLoading,
    branchesLoading,
    error,
  };
}
