import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProjectKey } from "./project-key.js";
import * as gitRemote from "./github/remote.js";

vi.mock("./github/remote.js", () => ({
  getGitRemoteUrl: vi.fn(),
}));

describe("getProjectKey", () => {
  const mockGetGitRemoteUrl = vi.mocked(gitRemote.getGitRemoteUrl);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ["git@github.com:owner/repo.git", "github.com-owner-repo"],
    ["git@github.com:owner/repo", "github.com-owner-repo"],
    ["git@gitlab.com:owner/repo.git", "gitlab.com-owner-repo"],
    ["git@bitbucket.org:owner/repo.git", "bitbucket.org-owner-repo"],
    ["git@github.com:org/subgroup/repo.git", "github.com-org-subgroup-repo"],
    ["https://github.com/owner/repo.git", "github.com-owner-repo"],
    ["https://github.com/owner/repo", "github.com-owner-repo"],
    ["https://gitlab.com/owner/repo.git", "gitlab.com-owner-repo"],
    ["https://gitlab.com/org/subgroup/repo.git", "gitlab.com-org-subgroup-repo"],
    ["https://git.company.com/team/project.git", "git.company.com-team-project"],
    ["https://github.com/my-org/my-repo.git", "github.com-my-org-my-repo"],
    ["git@github.com:my_org/my_repo.git", "github.com-my_org-my_repo"],
  ])("normalizes remote URL %s to %s", (remoteUrl, expectedKey) => {
    mockGetGitRemoteUrl.mockReturnValue(remoteUrl);
    expect(getProjectKey("/some/path")).toBe(expectedKey);
  });

  describe("without git remote URL", () => {
    beforeEach(() => {
      mockGetGitRemoteUrl.mockReturnValue(null);
    });

    it("falls back to path hash", () => {
      expect(getProjectKey("/some/path")).toMatch(/^path-[a-f0-9]{12}$/);
    });

    it("generates consistent hash for same path", () => {
      const key1 = getProjectKey("/some/specific/path");
      const key2 = getProjectKey("/some/specific/path");
      expect(key1).toBe(key2);
    });

    it("generates different hash for different paths", () => {
      const key1 = getProjectKey("/path/one");
      const key2 = getProjectKey("/path/two");
      expect(key1).not.toBe(key2);
    });
  });

  describe("malformed URLs", () => {
    it("falls back to URL hash for unparseable URL", () => {
      mockGetGitRemoteUrl.mockReturnValue("not-a-valid-url");
      expect(getProjectKey("/some/path")).toMatch(/^url-[a-f0-9]{12}$/);
    });

    it("generates consistent hash for same malformed URL", () => {
      mockGetGitRemoteUrl.mockReturnValue("weird://url");
      const key1 = getProjectKey("/path1");
      const key2 = getProjectKey("/path2");
      expect(key1).toBe(key2);
    });
  });
});
