import type { Route } from "next";

type AppRoutePolicy =
  | { type: "allow" }
  | { type: "redirect"; href: Route }
  | { type: "feature-not-enabled"; href: Route; label: string };

type WorkspaceNavItem = {
  href: Route;
  label: string;
};

export const APP_LANDING_PATH = "/app/runs" as Route;
export const SETUP_GITHUB_PATH = "/dashboard/github/setup" as Route;
export const SETUP_PROVIDER_PATH = "/onboarding/provider" as Route;

const workspaceNavItems: WorkspaceNavItem[] = [
  { href: APP_LANDING_PATH, label: "Runs" },
  { href: "/app/settings" as Route, label: "Settings" },
];

const mockProductRoutePrefixes = [
  "/app/projects",
  "/app/coworkers",
  "/onboarding/coworkers",
  "/onboarding/rules",
] as const;

export function getWorkspaceNavItems(): WorkspaceNavItem[] {
  return workspaceNavItems.map((item) => ({ ...item }));
}

export function getAppRoutePolicy(pathname: string): AppRoutePolicy {
  if (pathname === "/app") {
    return { type: "redirect", href: APP_LANDING_PATH };
  }

  if (
    mockProductRoutePrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return { type: "feature-not-enabled", href: APP_LANDING_PATH, label: "Runs" };
  }

  return { type: "allow" };
}

export const DEFAULT_ORGANIZATION_NEXT_PATH = SETUP_GITHUB_PATH;

type SetupStateInput = {
  hasGitHubInstallation: boolean;
  hasProviderCredential: boolean;
};

export function getMissingSetupPath({
  hasGitHubInstallation,
  hasProviderCredential,
}: SetupStateInput): Route | null {
  if (!hasGitHubInstallation) {
    return SETUP_GITHUB_PATH;
  }

  if (!hasProviderCredential) {
    return SETUP_PROVIDER_PATH;
  }

  return null;
}

type SearchParamValue = string | string[] | undefined;
type GitHubSetupNextParams = {
  installationId?: string;
  setupAction?: string;
  state?: string;
};

export function firstSearchParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeOrganizationNextPath(nextPath: string | null | undefined): Route {
  const candidate = typeof nextPath === "string" ? nextPath.trim() : "";

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return DEFAULT_ORGANIZATION_NEXT_PATH;
  }

  try {
    const parsedUrl = new URL(candidate, "http://coworker.local");
    const normalizedPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    return normalizedPath === "/" ? DEFAULT_ORGANIZATION_NEXT_PATH : (normalizedPath as Route);
  } catch {
    return DEFAULT_ORGANIZATION_NEXT_PATH;
  }
}

export function createOrganizationHref(nextPath: string | null | undefined): Route {
  const params = new URLSearchParams({ next: normalizeOrganizationNextPath(nextPath) });
  return `/onboarding/organization?${params.toString()}` as Route;
}

export function createGitHubSetupNextPath({
  installationId,
  setupAction,
}: GitHubSetupNextParams): Route {
  const query = new URLSearchParams();

  if (installationId) {
    query.set("installation_id", installationId);
  }
  if (setupAction) {
    query.set("setup_action", setupAction);
  }

  const queryString = query.toString();
  return queryString ? (`/dashboard/github/setup?${queryString}` as Route) : DEFAULT_ORGANIZATION_NEXT_PATH;
}
