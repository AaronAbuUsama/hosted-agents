import { describe, expect, test } from "bun:test";

import { coderBranchName, slugifyIssueTitle } from "./coder-branch";

describe("coder branch naming", () => {
  test("slugifies a title into a safe, lowercased, hyphenated ref segment", () => {
    expect(slugifyIssueTitle("Add a Widget!")).toBe("add-a-widget");
    expect(slugifyIssueTitle("  Fix   the   BUG  ")).toBe("fix-the-bug");
    expect(slugifyIssueTitle("Support C++ & Rust (v2)")).toBe("support-c-rust-v2");
  });

  test("caps the slug length and trims a trailing hyphen left by the cut", () => {
    const slug = slugifyIssueTitle("a".repeat(80));
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).not.toMatch(/-$/);

    // A cut that would land on a separator does not leave a dangling hyphen.
    const cut = slugifyIssueTitle(`${"word ".repeat(20)}`);
    expect(cut).not.toMatch(/-$/);
  });

  test("falls back to `issue` when the title has no usable characters", () => {
    expect(slugifyIssueTitle("🚀🚀🚀")).toBe("issue");
    expect(slugifyIssueTitle("   ")).toBe("issue");
    expect(slugifyIssueTitle("")).toBe("issue");
  });

  test("builds the coder/issue-<n>-<slug> branch name", () => {
    expect(coderBranchName(42, "Add a Widget!")).toBe("coder/issue-42-add-a-widget");
    expect(coderBranchName(7, "🚀")).toBe("coder/issue-7-issue");
  });
});
