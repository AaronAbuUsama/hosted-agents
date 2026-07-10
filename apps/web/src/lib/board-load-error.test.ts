/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  githubInstallationSettingsUrl,
  mapBoardLoadError,
  type BoardLoadErrorContent,
} from "./board-load-error";

// The 403 the oRPC transport forwards verbatim when the installation can't read
// Issues — the shape produced by fetchGitHubJson in packages/api (github-app.ts).
const FORBIDDEN_ERROR = new Error(
  'GitHub API GET /repos/acme/widgets/issues?state=open failed: 403 {"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest"}',
);

describe("mapBoardLoadError", () => {
  test("names the Issues-access cause and links to the installation settings on a 403", () => {
    const content = mapBoardLoadError(FORBIDDEN_ERROR, {
      installationSettingsUrl: "https://github.com/organizations/acme/settings/installations/42",
    });

    expect(content.title).toBe("This installation doesn't have Issues access");
    expect(content.description).toContain("Issues");
    expect(content.cta).toEqual({
      label: "Open GitHub settings",
      href: "https://github.com/organizations/acme/settings/installations/42",
    });
  });

  test("matches the forbidden message case-insensitively regardless of surrounding text", () => {
    const content = mapBoardLoadError(new Error("resource not accessible by integration"), {
      installationSettingsUrl: "https://github.com/settings/installations/7",
    });

    expect(content.title).toBe("This installation doesn't have Issues access");
    expect(content.cta?.href).toBe("https://github.com/settings/installations/7");
  });

  test("omits the CTA when the installation settings URL is unavailable", () => {
    const withoutUrl = mapBoardLoadError(FORBIDDEN_ERROR, { installationSettingsUrl: null });
    const withNoOptions = mapBoardLoadError(FORBIDDEN_ERROR);

    for (const content of [withoutUrl, withNoOptions] satisfies BoardLoadErrorContent[]) {
      expect(content.title).toBe("This installation doesn't have Issues access");
      expect(content.cta).toBeUndefined();
    }
  });

  test("keeps generic copy for a non-403 failure and surfaces its message", () => {
    const content = mapBoardLoadError(new Error("GitHub installation is suspended."), {
      installationSettingsUrl: "https://github.com/settings/installations/7",
    });

    expect(content.title).toBe("Couldn't load issues");
    expect(content.description).toBe("GitHub installation is suspended.");
    // A generic failure never offers the Issues-access fix CTA.
    expect(content.cta).toBeUndefined();
  });

  test("falls back to generic description when the error carries no message", () => {
    const fromEmpty = mapBoardLoadError(new Error(""));
    const fromNonError = mapBoardLoadError({ weird: true });

    for (const content of [fromEmpty, fromNonError]) {
      expect(content.title).toBe("Couldn't load issues");
      expect(content.description).toBe(
        "GitHub did not return this repository's issues. Check the installation and try again.",
      );
      expect(content.cta).toBeUndefined();
    }
  });

  test("accepts a raw string error", () => {
    const content = mapBoardLoadError("Resource not accessible by integration", {
      installationSettingsUrl: "https://github.com/settings/installations/9",
    });

    expect(content.title).toBe("This installation doesn't have Issues access");
    expect(content.cta?.href).toBe("https://github.com/settings/installations/9");
  });
});

describe("githubInstallationSettingsUrl", () => {
  test("builds the organization installation settings URL", () => {
    expect(
      githubInstallationSettingsUrl({
        accountLogin: "acme",
        accountType: "Organization",
        installationId: "42",
      }),
    ).toBe("https://github.com/organizations/acme/settings/installations/42");
  });

  test("builds the personal installation settings URL for a user account", () => {
    expect(
      githubInstallationSettingsUrl({
        accountLogin: "octocat",
        accountType: "User",
        installationId: "7",
      }),
    ).toBe("https://github.com/settings/installations/7");
  });

  test("falls back to the personal path when the org login is missing", () => {
    expect(
      githubInstallationSettingsUrl({
        accountLogin: null,
        accountType: "Organization",
        installationId: "7",
      }),
    ).toBe("https://github.com/settings/installations/7");
  });

  test("returns null when there is no installation id to address", () => {
    expect(
      githubInstallationSettingsUrl({
        accountLogin: "acme",
        accountType: "Organization",
        installationId: null,
      }),
    ).toBeNull();
  });
});
