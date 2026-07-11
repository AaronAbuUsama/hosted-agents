// The issues board reads GitHub issues through the repository's installation. If
// that installation lacks Issues access, GitHub answers a 403 "Resource not
// accessible by integration" — a distinct, fixable failure whose next step is
// specific (grant the app Issues access on the installation), unlike every other
// failure, which keeps generic copy. Mapping the error to content is a pure
// function so the board's error branch has one definition, unit-testable without
// a DOM.

export type BoardLoadErrorCta = {
  label: string;
  href: string;
};

export type BoardLoadErrorContent = {
  title: string;
  description: string;
  // Present only for the Issues-access failure, and only when we can build the
  // installation's settings URL. Other failures never carry a CTA.
  cta?: BoardLoadErrorCta;
};

// GitHub's canonical body message when an installation token hits a resource the
// app has no permission for. The oRPC transport forwards the underlying error
// verbatim (see listRepositoryIssues in packages/api), so this string rides
// through in the client-side error message alongside the 403 status.
const GITHUB_FORBIDDEN_MESSAGE = "resource not accessible by integration";

const GENERIC_TITLE = "Couldn't load issues";
const GENERIC_DESCRIPTION =
  "GitHub did not return this repository's issues. Check the installation and try again.";

const FORBIDDEN_TITLE = "This installation doesn't have Issues access";
const FORBIDDEN_DESCRIPTION =
  "GitHub refused the board's request because this repository's installation can't read Issues. Grant the GitHub App access to Issues on the installation, then reload the board.";
const FORBIDDEN_CTA_LABEL = "Open GitHub settings";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function isIssuesForbidden(message: string): boolean {
  return message.toLowerCase().includes(GITHUB_FORBIDDEN_MESSAGE);
}

// Build the installation's GitHub settings page — where the installer reviews the
// app's repository access and accepts new permission requests. Organization
// installations live under /organizations/<login>; user installations under the
// personal /settings. Both then carry /installations/<numeric installation id>.
// Returns null when we lack the id needed to address the page.
export function githubInstallationSettingsUrl(input: {
  accountLogin: string | null | undefined;
  accountType: string | null | undefined;
  installationId: string | null | undefined;
}): string | null {
  const { accountLogin, accountType, installationId } = input;
  if (!installationId) {
    return null;
  }
  if (accountType?.toLowerCase() === "organization" && accountLogin) {
    return `https://github.com/organizations/${accountLogin}/settings/installations/${installationId}`;
  }
  return `https://github.com/settings/installations/${installationId}`;
}

// Map a board-load failure to the copy (and optional fix CTA) the error branch
// renders. The Issues-access 403 gets its named cause and a link to the
// installation's settings page; everything else keeps generic copy.
export function mapBoardLoadError(
  error: unknown,
  options: { installationSettingsUrl?: string | null } = {},
): BoardLoadErrorContent {
  const message = errorMessage(error);

  if (isIssuesForbidden(message)) {
    const content: BoardLoadErrorContent = {
      title: FORBIDDEN_TITLE,
      description: FORBIDDEN_DESCRIPTION,
    };
    if (options.installationSettingsUrl) {
      content.cta = {
        label: FORBIDDEN_CTA_LABEL,
        href: options.installationSettingsUrl,
      };
    }
    return content;
  }

  return {
    title: GENERIC_TITLE,
    description: message || GENERIC_DESCRIPTION,
  };
}
