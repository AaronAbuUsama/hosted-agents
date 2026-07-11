// The Coder's branch naming, kept pure so it is trivially testable and has no
// sandbox/GitHub dependency. Every implementation run cuts `coder/issue-<n>-<slug>`
// from the default branch (spec #21). The slug is derived from the issue title,
// normalized to a safe, bounded git ref segment: lowercase, non-alphanumerics
// collapsed to single hyphens, trimmed, and length-capped. When a title has no
// usable characters (emoji-only, CJK-only, empty) the slug falls back to `issue`
// so the branch is always a valid, predictable ref.

const MAX_SLUG_LENGTH = 50;

export function slugifyIssueTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "issue";
}

export function coderBranchName(issueNumber: number, title: string): string {
  return `coder/issue-${issueNumber}-${slugifyIssueTitle(title)}`;
}

// The inverse of `coderBranchName`: recover the issue number from a Coder branch
// ref so the babysit admission (C6) can match a `pull_request_review` to the issue
// its PR closes, even before/without the linked-PR stamp. Only matches the exact
// `coder/issue-<n>-<slug>` shape this module produces; any other ref (a human's
// branch, a differently-named branch) returns null so it is never babysat.
export function parseCoderIssueBranch(ref: string): number | null {
  const match = /^coder\/issue-(\d+)-/.exec(ref.trim());
  if (!match) {
    return null;
  }
  const issueNumber = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(issueNumber) && issueNumber > 0 ? issueNumber : null;
}
