import { useEffect, useState } from 'react';
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

export interface GitHubSelectorsState {
  user: GitHubUser | null;
  orgs: GitHubOrg[];
  repos: GitHubRepo[];
  branches: GitHubBranch[];
  ownersLoading: boolean;
  reposLoading: boolean;
  branchesLoading: boolean;
  ownersError: string | null;
  reposError: string | null;
  branchesError: string | null;
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
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [orgs, setOrgs] = useState<GitHubOrg[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [reposLoading, setReposLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const owner = config.kind === 'github' ? config.owner : '';
  const repo = config.kind === 'github' ? config.repo : '';

  useEffect(() => {
    if (!tokenPresent || config.kind !== 'github') {
      setUser(null);
      setOrgs([]);
      setOwnersError(null);
      return;
    }

    const abort = new AbortController();
    setOwnersLoading(true);
    setOwnersError(null);

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
          setOwnersError(
            error instanceof Error
              ? error.message
              : 'Failed to load GitHub account.',
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
  }, [tokenPresent, credentialId, config.kind]);

  useEffect(() => {
    if (!tokenPresent || config.kind !== 'github' || !user || !owner.trim()) {
      setRepos([]);
      setReposError(null);
      return;
    }

    const ownerName = owner.trim();
    const abort = new AbortController();
    setReposLoading(true);
    setReposError(null);

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
          setReposError(
            error instanceof Error
              ? error.message
              : 'Failed to load repositories.',
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
  }, [tokenPresent, credentialId, config.kind, owner, user]);

  useEffect(() => {
    if (
      !tokenPresent ||
      config.kind !== 'github' ||
      !owner.trim() ||
      !repo.trim()
    ) {
      setBranches([]);
      setBranchesError(null);
      return;
    }

    const ownerName = owner.trim();
    const repoName = repo.trim();
    const abort = new AbortController();
    setBranchesLoading(true);
    setBranchesError(null);

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
          setBranchesError(
            error instanceof Error ? error.message : 'Failed to load branches.',
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
  }, [tokenPresent, credentialId, config.kind, owner, repo]);

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
    ownersError,
    reposError,
    branchesError,
  };
}
