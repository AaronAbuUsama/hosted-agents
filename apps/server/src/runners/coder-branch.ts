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
