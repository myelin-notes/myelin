import { fetch } from '@tauri-apps/plugin-http';
import {
  GITHUB_SIGN_IN_REQUIRED,
  getGitHubToken,
  requireGitHubSignIn,
} from './credentials';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

async function authHeaders(
  credentialId: string,
  forceRefresh = false,
): Promise<Record<string, string>> {
  const token = await getGitHubToken(credentialId, { forceRefresh });
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'myelin',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

async function githubGet<T>(
  credentialId: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const request = async (forceRefresh: boolean) =>
    fetch(`${GITHUB_API_BASE}${path}`, {
      method: 'GET',
      headers: await authHeaders(credentialId, forceRefresh),
      signal,
    });

  let response = await request(false);
  if (response.status === 401) {
    response = await request(true);
  }
  if (response.status === 401) {
    await requireGitHubSignIn(credentialId);
    throw new Error(GITHUB_SIGN_IN_REQUIRED);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '<no response body>');
    throw new Error(`GitHub request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

export interface GitHubUser {
  login: string;
  avatarUrl: string | null;
}

export interface GitHubOrg {
  login: string;
  avatarUrl: string | null;
}

export interface GitHubRepo {
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
}

interface GitHubUserResponse {
  login: string;
  avatar_url?: string | null;
}

interface GitHubOrgResponse {
  login: string;
  avatar_url?: string | null;
}

interface GitHubRepoResponse {
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  pushed_at: string | null;
}

export async function fetchGitHubUser(
  credentialId: string,
  signal?: AbortSignal,
): Promise<GitHubUser> {
  const payload = await githubGet<GitHubUserResponse>(
    credentialId,
    '/user',
    signal,
  );
  return {
    login: payload.login,
    avatarUrl: payload.avatar_url ?? null,
  };
}

export async function fetchGitHubOrgs(
  credentialId: string,
  signal?: AbortSignal,
): Promise<GitHubOrg[]> {
  const payload = await githubGet<GitHubOrgResponse[]>(
    credentialId,
    '/user/orgs?per_page=100',
    signal,
  );
  return payload.map((org) => ({
    login: org.login,
    avatarUrl: org.avatar_url ?? null,
  }));
}

function mapRepo(payload: GitHubRepoResponse): GitHubRepo {
  return {
    name: payload.name,
    owner: payload.owner.login,
    defaultBranch: payload.default_branch,
    private: payload.private,
  };
}

function sortReposByRecency(repos: GitHubRepoResponse[]): GitHubRepoResponse[] {
  return [...repos].sort((a, b) => {
    const aTime = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
    const bTime = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
    return bTime - aTime;
  });
}

export async function fetchGitHubReposForUser(
  credentialId: string,
  signal?: AbortSignal,
): Promise<GitHubRepo[]> {
  const payload = await githubGet<GitHubRepoResponse[]>(
    credentialId,
    '/user/repos?affiliation=owner&per_page=100&sort=pushed',
    signal,
  );
  return sortReposByRecency(payload).map(mapRepo);
}

export async function fetchGitHubReposForOrg(
  credentialId: string,
  org: string,
  signal?: AbortSignal,
): Promise<GitHubRepo[]> {
  const payload = await githubGet<GitHubRepoResponse[]>(
    credentialId,
    `/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed`,
    signal,
  );
  return sortReposByRecency(payload).map(mapRepo);
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

interface GitHubBranchResponse {
  name: string;
  protected?: boolean;
}

export async function fetchGitHubBranches(
  credentialId: string,
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<GitHubBranch[]> {
  const payload = await githubGet<GitHubBranchResponse[]>(
    credentialId,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
    signal,
  );
  return payload.map((branch) => ({
    name: branch.name,
    protected: branch.protected ?? false,
  }));
}
