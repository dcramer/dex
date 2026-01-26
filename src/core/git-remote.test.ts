import { describe, it, expect } from "vitest";
import { parseGitHubUrl, parseGitHubIssueRef } from "./github/index.js";

describe("parseGitHubUrl", () => {
  it.each([
    ["https://github.com/owner/repo.git", { owner: "owner", repo: "repo" }],
    ["https://github.com/owner/repo", { owner: "owner", repo: "repo" }],
    ["https://github.com/my-org/my-repo.git", { owner: "my-org", repo: "my-repo" }],
    ["https://github.com/my_org/my_repo", { owner: "my_org", repo: "my_repo" }],
    ["git@github.com:owner/repo.git", { owner: "owner", repo: "repo" }],
    ["git@github.com:owner/repo", { owner: "owner", repo: "repo" }],
    ["git@github.com:my-org/my-repo.git", { owner: "my-org", repo: "my-repo" }],
  ])("parses valid GitHub URL: %s", (url, expected) => {
    expect(parseGitHubUrl(url)).toEqual(expected);
  });

  it.each([
    "https://gitlab.com/owner/repo.git",
    "https://bitbucket.org/owner/repo.git",
    "git@gitlab.com:owner/repo.git",
    "https://git.company.com/owner/repo.git",
    "",
    "not-a-url",
    "https://github.com/owner",
  ])("returns null for non-GitHub or invalid URL: %s", (url) => {
    expect(parseGitHubUrl(url)).toBeNull();
  });
});

describe("parseGitHubIssueRef", () => {
  it.each([
    ["https://github.com/owner/repo/issues/123", { owner: "owner", repo: "repo", number: 123 }],
    ["http://github.com/owner/repo/issues/456", { owner: "owner", repo: "repo", number: 456 }],
    ["https://github.com/my-org/my-repo/issues/789", { owner: "my-org", repo: "my-repo", number: 789 }],
    ["owner/repo#123", { owner: "owner", repo: "repo", number: 123 }],
    ["my-org/my-repo#456", { owner: "my-org", repo: "my-repo", number: 456 }],
  ])("parses valid issue reference: %s", (ref, expected) => {
    expect(parseGitHubIssueRef(ref)).toEqual(expected);
  });

  describe("number-only format with default repo", () => {
    const defaultRepo = { owner: "default-owner", repo: "default-repo" };
    const expectedResult = { ...defaultRepo, number: 123 };

    it.each([
      ["#123", expectedResult],
      ["123", { ...defaultRepo, number: 123 }],
    ])("parses %s with default repo", (ref, expected) => {
      expect(parseGitHubIssueRef(ref, defaultRepo)).toEqual(expected);
    });

    it.each(["#123", "123"])("returns null for %s without default repo", (ref) => {
      expect(parseGitHubIssueRef(ref)).toBeNull();
    });
  });

  it.each([
    "",
    "not-an-issue",
    "https://github.com/owner/repo/pull/123",
  ])("returns null for invalid reference: %s", (ref) => {
    expect(parseGitHubIssueRef(ref)).toBeNull();
  });
});
