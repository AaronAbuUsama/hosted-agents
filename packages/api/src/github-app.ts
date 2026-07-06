import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { db } from "@hosted-agents/db";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { env } from "@hosted-agents/env/server";
import { eq } from "drizzle-orm";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

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

type GitHubInstallationTokenResponse = {
  token: string;
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

function assertGitHubAppConfigured() {
  if (!env.GITHUB_APP_ID) {
    throw new Error("GITHUB_APP_ID is not configured.");
  }

  if (!env.GITHUB_APP_SLUG) {
    throw new Error("GITHUB_APP_SLUG is not configured.");
  }

  if (!env.GITHUB_APP_PRIVATE_KEY && !env.GITHUB_APP_PRIVATE_KEY_PATH) {
    throw new Error("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is not configured.");
  }
}

export function isGitHubAppConfigured() {
  return Boolean(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    (env.GITHUB_APP_PRIVATE_KEY || env.GITHUB_APP_PRIVATE_KEY_PATH),
  );
}

export function createGitHubAppInstallUrl(organizationId: string) {
  if (!env.GITHUB_APP_SLUG) {
    throw new Error("GITHUB_APP_SLUG is not configured.");
  }

  const url = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set("state", organizationId);
  return url.toString();
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

function readGitHubAppPrivateKey() {
  if (env.GITHUB_APP_PRIVATE_KEY) {
    return env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n");
  }

  if (!env.GITHUB_APP_PRIVATE_KEY_PATH) {
    throw new Error("GITHUB_APP_PRIVATE_KEY_PATH is not configured.");
  }

  const privateKeyPath = resolvePrivateKeyPath(env.GITHUB_APP_PRIVATE_KEY_PATH);

  if (!existsSync(privateKeyPath)) {
    throw new Error(`GitHub App private key was not found at ${privateKeyPath}.`);
  }

  return readFileSync(privateKeyPath, "utf8");
}

function createGitHubAppJwt() {
  assertGitHubAppConfigured();

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: env.GITHUB_APP_ID,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  return `${unsignedToken}.${base64UrlEncode(signer.sign(readGitHubAppPrivateKey()))}`;
}

async function fetchGitHubJson<T>(
  path: string,
  {
    token,
    method = "GET",
  }: {
    token: string;
    method?: "GET" | "POST";
  },
) {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "hosted-agents-local",
      "x-github-api-version": GITHUB_API_VERSION,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

export async function createGitHubInstallationAccessToken(installationId: string) {
  const response = await fetchGitHubJson<GitHubInstallationTokenResponse>(
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      token: createGitHubAppJwt(),
    },
  );

  return response.token;
}

async function listInstallationRepositories(installationId: string) {
  const token = await createGitHubInstallationAccessToken(installationId);
  const response = await fetchGitHubJson<GitHubInstallationRepositoriesResponse>(
    "/installation/repositories?per_page=100",
    {
      token,
    },
  );

  return response.repositories ?? [];
}

async function getInstallation(installationId: string) {
  return fetchGitHubJson<GitHubInstallationResponse>(`/app/installations/${installationId}`, {
    token: createGitHubAppJwt(),
  });
}

function toNullableDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

export async function claimGitHubInstallation({
  organizationId,
  userId,
  installationId,
  setupAction,
}: ClaimGitHubInstallationInput) {
  const installation = await getInstallation(installationId);
  const repositories = await listInstallationRepositories(installationId);
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
      appSlug: env.GITHUB_APP_SLUG ?? "unknown",
      accountId: installation.account?.id ? String(installation.account.id) : null,
      accountLogin: installation.account?.login ?? null,
      accountType: installation.account?.type ?? null,
      repositorySelection: installation.repository_selection ?? null,
      status: installation.suspended_at ? "suspended" : "connected",
      setupAction: setupAction ?? null,
      installedByUserId: userId,
      suspendedAt: toNullableDate(installation.suspended_at),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: githubInstallation.installationId,
      set: {
        organizationId,
        appSlug: env.GITHUB_APP_SLUG ?? "unknown",
        accountId: installation.account?.id ? String(installation.account.id) : null,
        accountLogin: installation.account?.login ?? null,
        accountType: installation.account?.type ?? null,
        repositorySelection: installation.repository_selection ?? null,
        status: installation.suspended_at ? "suspended" : "connected",
        setupAction: setupAction ?? null,
        installedByUserId: userId,
        suspendedAt: toNullableDate(installation.suspended_at),
        updatedAt: now,
      },
    });

  for (const repository of repositories) {
    const repositoryId = String(repository.id);
    const owner = repository.owner?.login ?? repository.full_name.split("/")[0] ?? "";

    await db
      .insert(githubRepository)
      .values({
        id: crypto.randomUUID(),
        installationId: id,
        githubRepositoryId: repositoryId,
        owner,
        name: repository.name,
        fullName: repository.full_name,
        htmlUrl: repository.html_url ?? null,
        defaultBranch: repository.default_branch ?? null,
        private: repository.private ?? false,
        selected: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [githubRepository.installationId, githubRepository.githubRepositoryId],
        set: {
          owner,
          name: repository.name,
          fullName: repository.full_name,
          htmlUrl: repository.html_url ?? null,
          defaultBranch: repository.default_branch ?? null,
          private: repository.private ?? false,
          selected: true,
          updatedAt: now,
        },
      });
  }

  return {
    installationId,
    repositoryCount: repositories.length,
  };
}
