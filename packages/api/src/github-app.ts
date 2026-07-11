import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { db } from "@hosted-agents/db";
import {
  CODE_REVIEW_WORKER_ROLE,
  IMPLEMENTATION_WORKER_ROLE,
} from "@hosted-agents/db/schema/agent-runs";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { env } from "@hosted-agents/env/server";
import { eq, inArray } from "drizzle-orm";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

// A GitHub App identity is selected by worker role, per ADR-0001. The reviewer
// app backs the code-review role (and is the default for every legacy caller);
// the Coder app backs the implementation role.
export type GitHubAppWorkerRole =
  | typeof CODE_REVIEW_WORKER_ROLE
  | typeof IMPLEMENTATION_WORKER_ROLE;

type GitHubAppCredentials = {
  role: GitHubAppWorkerRole;
  displayName: string;
  appId: string | undefined;
  appSlug: string | undefined;
  privateKey: string | undefined;
  privateKeyPath: string | undefined;
};

function githubAppCredentials(
  role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE,
): GitHubAppCredentials {
  if (role === IMPLEMENTATION_WORKER_ROLE) {
    return {
      role: IMPLEMENTATION_WORKER_ROLE,
      displayName: "Coder",
      appId: env.GITHUB_CODER_APP_ID,
      appSlug: env.GITHUB_CODER_APP_SLUG,
      privateKey: env.GITHUB_CODER_APP_PRIVATE_KEY,
      privateKeyPath: env.GITHUB_CODER_APP_PRIVATE_KEY_PATH,
    };
  }

  return {
    role: CODE_REVIEW_WORKER_ROLE,
    displayName: "Reviewer",
    appId: env.GITHUB_APP_ID,
    appSlug: env.GITHUB_APP_SLUG,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    privateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH,
  };
}

function areGitHubAppCredentialsConfigured(credentials: GitHubAppCredentials) {
  return Boolean(
    credentials.appId &&
    credentials.appSlug &&
    (credentials.privateKey || credentials.privateKeyPath),
  );
}

// Maps a recorded installation's app slug back to the worker role whose GitHub
// App owns it. Both apps deliver the same webhook events to the same channel,
// so admission and run planning use this to attribute a delivery to a role
// (e.g. so a Coder-app pull_request delivery never spawns a duplicate review).
export function resolveGitHubAppWorkerRole(appSlug: string | null): GitHubAppWorkerRole {
  const coderSlug = env.GITHUB_CODER_APP_SLUG;

  if (coderSlug && appSlug === coderSlug) {
    return IMPLEMENTATION_WORKER_ROLE;
  }

  return CODE_REVIEW_WORKER_ROLE;
}

type GitHubInstallationResponse = {
  id: number;
  account?: {
    id?: number;
    login?: string;
    type?: string;
  } | null;
  repository_selection?: string;
  suspended_at?: string | null;
};

type GitHubAppInstallationsResponse = GitHubInstallationResponse[];

// GitHub's create-installation-access-token endpoint reports the permissions the
// minted token carries — i.e. the installation's granted scopes, keyed by scope
// name ("issues", "pull_requests", …) → access level ("read" | "write"). We read
// `issues` from here to catch the board's silent-failure mode: an app with
// pull_requests:read but no issues:read gets a 200 (only PRs) from GET /issues,
// which the PR filter empties — masking the real cause behind a "no issues" board.
export type GitHubInstallationPermissions = Record<string, string>;

type GitHubInstallationTokenResponse = {
  token: string;
  permissions?: GitHubInstallationPermissions | null;
};

export type GitHubInstallationToken = {
  token: string;
  // Null when GitHub omitted the field. Callers must fail open on null (assume no
  // scope is missing) rather than block a working board on a response-shape change.
  permissions: GitHubInstallationPermissions | null;
};

type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  html_url?: string | null;
  default_branch?: string | null;
  private?: boolean;
  owner?: {
    login?: string;
  } | null;
};

type GitHubInstallationRepositoriesResponse = {
  repositories?: GitHubRepositoryResponse[];
};

export type ClaimGitHubInstallationInput = {
  organizationId: string;
  userId: string;
  installationId: string;
  setupAction?: string;
};

export type GitHubAvailableInstallation = {
  installationId: string;
  accountId: string | null;
  accountLogin: string | null;
  accountType: string | null;
  repositorySelection: string | null;
  status: "connected" | "suspended";
  suspendedAt: string | null;
  repositoryCount: number;
  repositories: {
    githubRepositoryId: string;
    owner: string;
    name: string;
    fullName: string;
    htmlUrl: string | null;
    defaultBranch: string | null;
    private: boolean;
  }[];
  linkStatus: "available" | "linked" | "linked_to_another_organization";
  localInstallationId: string | null;
};

function assertGitHubAppConfigured(credentials: GitHubAppCredentials) {
  const prefix =
    credentials.role === IMPLEMENTATION_WORKER_ROLE ? "GITHUB_CODER_APP" : "GITHUB_APP";

  if (!credentials.appId) {
    throw new Error(`${prefix}_ID is not configured.`);
  }

  if (!credentials.appSlug) {
    throw new Error(`${prefix}_SLUG is not configured.`);
  }

  if (!credentials.privateKey && !credentials.privateKeyPath) {
    throw new Error(`${prefix}_PRIVATE_KEY or ${prefix}_PRIVATE_KEY_PATH is not configured.`);
  }
}

export function isGitHubAppConfigured(role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE) {
  return areGitHubAppCredentialsConfigured(githubAppCredentials(role));
}

export function createGitHubAppInstallUrl(
  organizationId: string,
  role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE,
) {
  const credentials = githubAppCredentials(role);

  if (!credentials.appSlug) {
    throw new Error(
      role === IMPLEMENTATION_WORKER_ROLE
        ? "GITHUB_CODER_APP_SLUG is not configured."
        : "GITHUB_APP_SLUG is not configured.",
    );
  }

  const url = new URL(`https://github.com/apps/${credentials.appSlug}/installations/new`);
  url.searchParams.set("state", organizationId);
  return url.toString();
}

export function getGitHubAppSlug(role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE) {
  return githubAppCredentials(role).appSlug ?? null;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function resolvePrivateKeyPath(path: string) {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return resolve(path);
}

function readGitHubAppPrivateKey(credentials: GitHubAppCredentials) {
  if (credentials.privateKey) {
    return credentials.privateKey.replaceAll("\\n", "\n");
  }

  const prefix =
    credentials.role === IMPLEMENTATION_WORKER_ROLE ? "GITHUB_CODER_APP" : "GITHUB_APP";

  if (!credentials.privateKeyPath) {
    throw new Error(`${prefix}_PRIVATE_KEY_PATH is not configured.`);
  }

  const privateKeyPath = resolvePrivateKeyPath(credentials.privateKeyPath);

  if (!existsSync(privateKeyPath)) {
    throw new Error(
      `${credentials.displayName} GitHub App private key was not found at ${privateKeyPath}.`,
    );
  }

  return readFileSync(privateKeyPath, "utf8");
}

function createGitHubAppJwt(role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE) {
  const credentials = githubAppCredentials(role);
  assertGitHubAppConfigured(credentials);

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: credentials.appId,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  return `${unsignedToken}.${base64UrlEncode(signer.sign(readGitHubAppPrivateKey(credentials)))}`;
}

async function fetchGitHubJson<T>(
  path: string,
  {
    token,
    method = "GET",
    body,
  }: {
    token: string;
    method?: "GET" | "POST";
    body?: unknown;
  },
) {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "hosted-agents-local",
      "x-github-api-version": GITHUB_API_VERSION,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

export async function createGitHubInstallationAccessTokenWithPermissions(
  installationId: string,
  role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE,
): Promise<GitHubInstallationToken> {
  const response = await fetchGitHubJson<GitHubInstallationTokenResponse>(
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      token: createGitHubAppJwt(role),
    },
  );

  return { token: response.token, permissions: response.permissions ?? null };
}

export async function createGitHubInstallationAccessToken(
  installationId: string,
  role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE,
) {
  const { token } = await createGitHubInstallationAccessTokenWithPermissions(installationId, role);
  return token;
}

type GitHubPullRequestResponse = {
  number: number;
  title?: string | null;
  html_url?: string | null;
  draft?: boolean;
  updated_at?: string | null;
  user?: { login?: string | null } | null;
  base?: { ref?: string | null; sha?: string | null } | null;
  head?: { ref?: string | null; sha?: string | null } | null;
};

export type GitHubPullRequestSummary = {
  number: number;
  title: string;
  htmlUrl: string | null;
  authorLogin: string | null;
  draft: boolean;
  updatedAt: string | null;
  baseRef: string | null;
  baseSha: string | null;
  headRef: string | null;
  headSha: string | null;
};

function mapPullRequestSummary(pullRequest: GitHubPullRequestResponse): GitHubPullRequestSummary {
  return {
    number: pullRequest.number,
    title: pullRequest.title ?? `PR #${pullRequest.number}`,
    htmlUrl: pullRequest.html_url ?? null,
    authorLogin: pullRequest.user?.login ?? null,
    draft: Boolean(pullRequest.draft),
    updatedAt: pullRequest.updated_at ?? null,
    baseRef: pullRequest.base?.ref ?? null,
    baseSha: pullRequest.base?.sha ?? null,
    headRef: pullRequest.head?.ref ?? null,
    headSha: pullRequest.head?.sha ?? null,
  };
}

export async function listOpenGitHubPullRequests(
  installationId: string,
  owner: string,
  repo: string,
): Promise<GitHubPullRequestSummary[]> {
  const token = await createGitHubInstallationAccessToken(installationId);
  const response = await fetchGitHubJson<GitHubPullRequestResponse[]>(
    `/repos/${owner}/${repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`,
    { token },
  );

  return response.map(mapPullRequestSummary);
}

export async function getGitHubPullRequest(
  installationId: string,
  owner: string,
  repo: string,
  pullRequestNumber: number,
): Promise<GitHubPullRequestSummary> {
  const token = await createGitHubInstallationAccessToken(installationId);
  const response = await fetchGitHubJson<GitHubPullRequestResponse>(
    `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`,
    { token },
  );

  return mapPullRequestSummary(response);
}

type GitHubIssueLabel = { name?: string | null } | string;

type GitHubIssueResponse = {
  number: number;
  node_id?: string | null;
  id?: number | null;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  html_url?: string | null;
  comments?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: { login?: string | null; avatar_url?: string | null } | null;
  labels?: GitHubIssueLabel[] | null;
  // Present only when the "issue" is actually a pull request.
  pull_request?: unknown;
};

export type GitHubIssueSummary = {
  number: number;
  nodeId: string | null;
  githubId: string | null;
  title: string;
  body: string | null;
  state: "open" | "closed";
  htmlUrl: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
  commentCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

function issueLabelNames(labels: GitHubIssueResponse["labels"]): string[] {
  if (!labels) {
    return [];
  }

  return labels
    .map((label) => (typeof label === "string" ? label : (label?.name ?? null)))
    .filter((name): name is string => Boolean(name));
}

function mapIssueSummary(issue: GitHubIssueResponse): GitHubIssueSummary {
  return {
    number: issue.number,
    nodeId: issue.node_id ?? null,
    githubId: issue.id != null ? String(issue.id) : null,
    title: issue.title ?? `Issue #${issue.number}`,
    body: issue.body ?? null,
    state: issue.state === "closed" ? "closed" : "open",
    htmlUrl: issue.html_url ?? null,
    authorLogin: issue.user?.login ?? null,
    authorAvatarUrl: issue.user?.avatar_url ?? null,
    labels: issueLabelNames(issue.labels),
    commentCount: issue.comments ?? 0,
    createdAt: issue.created_at ?? null,
    updatedAt: issue.updated_at ?? null,
  };
}

// GitHub shares one number space between issues and pull requests, and the issues
// endpoint returns both; a `pull_request` field marks the PRs, which we exclude.
function isPullRequest(issue: GitHubIssueResponse): boolean {
  return issue.pull_request != null;
}

// GitHub's canonical 403 body when an app touches a resource it lacks permission
// for. The board's client-side error mapper keys off this phrase to name the
// Issues-access cause and offer a fix CTA (apps/web board-load-error). We reuse it
// here so the silent 200-with-only-PRs failure — an app with pull_requests:read
// but no issues:read — surfaces that same named error and CTA instead of an empty
// "no issues yet" board (the exact scenario the board's error branch targets).
const ISSUES_ACCESS_FORBIDDEN_MESSAGE =
  "Resource not accessible by integration: the GitHub App installation is missing Issues (read) access. Grant the app Issues access on the installation, then reload the board.";

// True only when GitHub affirmatively reported the token's permissions and Issues
// is not among them. A null/absent permissions map fails open — never block a
// working board on a missing or reshaped response field.
function issuesReadPermissionMissing(permissions: GitHubInstallationPermissions | null): boolean {
  if (!permissions) {
    return false;
  }
  const issues = permissions.issues;
  return issues !== "read" && issues !== "write";
}

export async function listGitHubIssues(
  installationId: string,
  owner: string,
  repo: string,
): Promise<GitHubIssueSummary[]> {
  const { token, permissions } =
    await createGitHubInstallationAccessTokenWithPermissions(installationId);

  // Gate before fetching: without issues:read, GET /issues answers 200 with only
  // PRs, so the empty result is indistinguishable from a repo with no issues. The
  // token's permissions are the one signal that tells the two apart.
  if (issuesReadPermissionMissing(permissions)) {
    throw new Error(ISSUES_ACCESS_FORBIDDEN_MESSAGE);
  }

  const response = await fetchGitHubJson<GitHubIssueResponse[]>(
    `/repos/${owner}/${repo}/issues?state=all&per_page=100&sort=updated&direction=desc`,
    { token },
  );

  return response.filter((issue) => !isPullRequest(issue)).map(mapIssueSummary);
}

export async function getGitHubIssue(
  installationId: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueSummary> {
  const token = await createGitHubInstallationAccessToken(installationId);
  const response = await fetchGitHubJson<GitHubIssueResponse>(
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
    { token },
  );

  return mapIssueSummary(response);
}

type GitHubIssueCommentResponse = {
  id?: number | null;
  body?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: { login?: string | null; avatar_url?: string | null } | null;
};

export type GitHubIssueCommentSummary = {
  githubId: string | null;
  body: string;
  htmlUrl: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function mapIssueCommentSummary(comment: GitHubIssueCommentResponse): GitHubIssueCommentSummary {
  return {
    githubId: comment.id != null ? String(comment.id) : null,
    body: comment.body ?? "",
    htmlUrl: comment.html_url ?? null,
    authorLogin: comment.user?.login ?? null,
    authorAvatarUrl: comment.user?.avatar_url ?? null,
    createdAt: comment.created_at ?? null,
    updatedAt: comment.updated_at ?? null,
  };
}

export async function listGitHubIssueComments(
  installationId: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueCommentSummary[]> {
  const token = await createGitHubInstallationAccessToken(installationId);
  const response = await fetchGitHubJson<GitHubIssueCommentResponse[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    { token },
  );

  return response.map(mapIssueCommentSummary);
}

export async function createGitHubIssueComment(
  installationId: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<GitHubIssueCommentSummary> {
  const token = await createGitHubInstallationAccessToken(installationId);
  const response = await fetchGitHubJson<GitHubIssueCommentResponse>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    { method: "POST", token, body: { body } },
  );

  return mapIssueCommentSummary(response);
}

async function listInstallationRepositories(
  installationId: string,
  role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE,
) {
  const token = await createGitHubInstallationAccessToken(installationId, role);
  const response = await fetchGitHubJson<GitHubInstallationRepositoriesResponse>(
    "/installation/repositories?per_page=100",
    {
      token,
    },
  );

  return response.repositories ?? [];
}

async function listGitHubAppInstallations(role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE) {
  const token = createGitHubAppJwt(role);
  const installations: GitHubInstallationResponse[] = [];
  let page = 1;

  while (true) {
    const pageInstallations = await fetchGitHubJson<GitHubAppInstallationsResponse>(
      `/app/installations?per_page=100&page=${page}`,
      {
        token,
      },
    );
    installations.push(...pageInstallations);

    if (pageInstallations.length < 100) {
      return installations;
    }

    page += 1;
  }
}

async function getInstallation(
  installationId: string,
  role: GitHubAppWorkerRole = CODE_REVIEW_WORKER_ROLE,
) {
  return fetchGitHubJson<GitHubInstallationResponse>(`/app/installations/${installationId}`, {
    token: createGitHubAppJwt(role),
  });
}

// Discovers which configured GitHub App owns an installation. Each app's JWT can
// only read its own installations, so we probe the configured apps in turn: the
// first whose `GET /app/installations/{id}` succeeds owns it. Claim uses this so
// the recorded `appSlug` (and the token-minting role) always match reality,
// whichever app the member just installed.
async function resolveInstallationCredentials(
  installationId: string,
): Promise<{ role: GitHubAppWorkerRole; installation: GitHubInstallationResponse }> {
  const roles: GitHubAppWorkerRole[] = [CODE_REVIEW_WORKER_ROLE, IMPLEMENTATION_WORKER_ROLE];
  let lastError: unknown = null;

  for (const role of roles) {
    if (!areGitHubAppCredentialsConfigured(githubAppCredentials(role))) {
      continue;
    }

    try {
      const installation = await getInstallation(installationId, role);
      return { role, installation };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `GitHub installation ${installationId} was not found for any configured GitHub App.`,
    { cause: lastError },
  );
}

function toNullableDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function installationStatus(installation: GitHubInstallationResponse) {
  return installation.suspended_at ? "suspended" : "connected";
}

function mapRepository(repository: GitHubRepositoryResponse) {
  const owner = repository.owner?.login ?? repository.full_name.split("/")[0] ?? "";

  return {
    githubRepositoryId: String(repository.id),
    owner,
    name: repository.name,
    fullName: repository.full_name,
    htmlUrl: repository.html_url ?? null,
    defaultBranch: repository.default_branch ?? null,
    private: repository.private ?? false,
  };
}

async function syncInstallationRepositories({
  installationRowId,
  repositories,
  now,
}: {
  installationRowId: string;
  repositories: GitHubRepositoryResponse[];
  now: Date;
}) {
  const selectedRepositoryIds = new Set(repositories.map((repository) => String(repository.id)));

  for (const repository of repositories) {
    const repositorySummary = mapRepository(repository);

    await db
      .insert(githubRepository)
      .values({
        id: crypto.randomUUID(),
        installationId: installationRowId,
        githubRepositoryId: repositorySummary.githubRepositoryId,
        owner: repositorySummary.owner,
        name: repositorySummary.name,
        fullName: repositorySummary.fullName,
        htmlUrl: repositorySummary.htmlUrl,
        defaultBranch: repositorySummary.defaultBranch,
        private: repositorySummary.private,
        selected: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [githubRepository.installationId, githubRepository.githubRepositoryId],
        set: {
          owner: repositorySummary.owner,
          name: repositorySummary.name,
          fullName: repositorySummary.fullName,
          htmlUrl: repositorySummary.htmlUrl,
          defaultBranch: repositorySummary.defaultBranch,
          private: repositorySummary.private,
          selected: true,
          updatedAt: now,
        },
      });
  }

  const persistedRepositories = await db
    .select({
      id: githubRepository.id,
      githubRepositoryId: githubRepository.githubRepositoryId,
    })
    .from(githubRepository)
    .where(eq(githubRepository.installationId, installationRowId));

  const staleRepositories = persistedRepositories.filter(
    (repository) => !selectedRepositoryIds.has(repository.githubRepositoryId),
  );

  for (const repository of staleRepositories) {
    await db.delete(githubRepository).where(eq(githubRepository.id, repository.id));
  }
}

export async function listAvailableGitHubInstallations({
  organizationId,
  role = CODE_REVIEW_WORKER_ROLE,
}: {
  organizationId: string;
  role?: GitHubAppWorkerRole;
}): Promise<GitHubAvailableInstallation[]> {
  const installations = await listGitHubAppInstallations(role);
  const installationIds = installations.map((installation) => String(installation.id));
  const linkedInstallations = installationIds.length
    ? await db
        .select()
        .from(githubInstallation)
        .where(inArray(githubInstallation.installationId, installationIds))
    : [];
  const linkedByInstallationId = new Map(
    linkedInstallations.map((installation) => [installation.installationId, installation]),
  );
  const availableInstallations: GitHubAvailableInstallation[] = [];

  for (const installation of installations) {
    const installationId = String(installation.id);
    const linkedInstallation = linkedByInstallationId.get(installationId);
    const repositories = await listInstallationRepositories(installationId, role);
    const linkStatus =
      linkedInstallation?.organizationId === organizationId
        ? "linked"
        : linkedInstallation
          ? "linked_to_another_organization"
          : "available";

    availableInstallations.push({
      installationId,
      accountId: installation.account?.id ? String(installation.account.id) : null,
      accountLogin: installation.account?.login ?? null,
      accountType: installation.account?.type ?? null,
      repositorySelection: installation.repository_selection ?? null,
      status: installationStatus(installation),
      suspendedAt: installation.suspended_at ?? null,
      repositoryCount: repositories.length,
      repositories: repositories.map(mapRepository),
      linkStatus,
      localInstallationId:
        linkStatus === "linked" && linkedInstallation ? linkedInstallation.id : null,
    });
  }

  return availableInstallations.sort((left, right) => {
    if (left.linkStatus !== right.linkStatus) {
      return left.linkStatus === "linked" ? -1 : right.linkStatus === "linked" ? 1 : 0;
    }

    return (left.accountLogin ?? left.installationId).localeCompare(
      right.accountLogin ?? right.installationId,
    );
  });
}

export async function claimGitHubInstallation({
  organizationId,
  userId,
  installationId,
  setupAction,
}: ClaimGitHubInstallationInput) {
  // Attribute the installation to whichever configured GitHub App owns it so the
  // recorded appSlug (reviewer vs Coder) is truthful and repository listing uses
  // the matching installation token.
  const { role, installation } = await resolveInstallationCredentials(installationId);
  const appSlug = githubAppCredentials(role).appSlug ?? "unknown";
  const repositories = await listInstallationRepositories(installationId, role);
  const existing = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1);
  const existingInstallation = existing[0];

  if (existingInstallation && existingInstallation.organizationId !== organizationId) {
    throw new Error("This GitHub installation is already linked to another organization.");
  }

  const id = existingInstallation?.id ?? crypto.randomUUID();
  const now = new Date();

  await db
    .insert(githubInstallation)
    .values({
      id,
      organizationId,
      installationId,
      appSlug,
      accountId: installation.account?.id ? String(installation.account.id) : null,
      accountLogin: installation.account?.login ?? null,
      accountType: installation.account?.type ?? null,
      repositorySelection: installation.repository_selection ?? null,
      status: installationStatus(installation),
      setupAction: setupAction ?? null,
      installedByUserId: userId,
      suspendedAt: toNullableDate(installation.suspended_at),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: githubInstallation.installationId,
      set: {
        organizationId,
        appSlug,
        accountId: installation.account?.id ? String(installation.account.id) : null,
        accountLogin: installation.account?.login ?? null,
        accountType: installation.account?.type ?? null,
        repositorySelection: installation.repository_selection ?? null,
        status: installationStatus(installation),
        setupAction: setupAction ?? null,
        installedByUserId: userId,
        suspendedAt: toNullableDate(installation.suspended_at),
        updatedAt: now,
      },
    });

  await syncInstallationRepositories({ installationRowId: id, repositories, now });

  return {
    installationId,
    repositoryCount: repositories.length,
  };
}
