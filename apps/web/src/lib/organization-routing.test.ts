/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  createGitHubSetupNextPath,
  createOrganizationHref,
  getAppRoutePolicy,
  getMissingSetupPath,
  getWorkspaceNavItems,
  normalizeOrganizationNextPath,
} from "./organization-routing";

describe("organization routing helper", () => {
  test("builds the no-organization redirect target for app routes", () => {
    expect(createOrganizationHref("/app")).toBe("/onboarding/organization?next=%2Fapp");
  });

  test("drops stale GitHub state when building no-org setup continuation", () => {
    const nextPath = createGitHubSetupNextPath({
      installationId: "123",
      setupAction: "install",
      state: "stale-org-id",
    });

    expect(nextPath).toBe("/dashboard/github/setup?installation_id=123&setup_action=install");
    expect(createOrganizationHref(nextPath)).toBe(
      "/onboarding/organization?next=%2Fdashboard%2Fgithub%2Fsetup%3Finstallation_id%3D123%26setup_action%3Dinstall",
    );
  });

  test("normalizes safe next paths for post-organization navigation", () => {
    expect(normalizeOrganizationNextPath("  /app/runs?status=queued#latest  ")).toBe(
      "/app/runs?status=queued#latest",
    );
  });

  test("keeps unsafe or empty next paths on the internal GitHub setup route", () => {
    for (const nextPath of [null, undefined, "", "https://evil.test/app", "//evil.test/app", "/"]) {
      expect(normalizeOrganizationNextPath(nextPath)).toBe("/dashboard/github/setup");
    }
  });
});

describe("truthful app shell routing", () => {
  test("resolves the next missing setup step before allowing the app workspace", () => {
    expect(
      getMissingSetupPath({
        hasGitHubInstallation: false,
        hasProviderCredential: false,
      }),
    ).toBe("/dashboard/github/setup");
    expect(
      getMissingSetupPath({
        hasGitHubInstallation: true,
        hasProviderCredential: false,
      }),
    ).toBe("/onboarding/provider");
    expect(
      getMissingSetupPath({
        hasGitHubInstallation: true,
        hasProviderCredential: true,
      }),
    ).toBe(null);
  });

  test("redirects the legacy app dashboard entrypoint to the real runs workspace", () => {
    expect(getAppRoutePolicy("/app")).toEqual({
      type: "redirect",
      href: "/app/runs",
    });
  });

  test("gates mock workspace and onboarding surfaces behind a feature-not-enabled route policy", () => {
    const disabledRoutes = [
      "/app/projects",
      "/app/projects/coworker-web",
      "/app/coworkers",
      "/app/coworkers/abu-bakr",
      "/onboarding/coworkers",
      "/onboarding/rules",
    ];

    for (const pathname of disabledRoutes) {
      expect(getAppRoutePolicy(pathname)).toEqual({
        type: "feature-not-enabled",
        href: "/app/runs",
        label: "Runs",
      });
    }
  });

  test("leaves the real runs workspace routable", () => {
    expect(getAppRoutePolicy("/app/runs")).toEqual({ type: "allow" });
    expect(getAppRoutePolicy("/app/runs/run-1")).toEqual({ type: "allow" });
  });

  test("exposes real workspace navigation without mock links or fake counts", () => {
    const navItems = getWorkspaceNavItems();

    expect(navItems).toEqual([
      { href: "/app/runs", label: "Runs" },
      { href: "/app/settings", label: "Settings" },
    ]);
    expect(navItems.some((item) => item.href.startsWith("/app/projects"))).toBe(false);
    expect(navItems.some((item) => item.href.startsWith("/app/coworkers"))).toBe(false);

    for (const item of navItems) {
      expect("count" in item).toBe(false);
    }
  });
});
