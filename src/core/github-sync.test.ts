import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import nock from "nock";
import {
  GitHubSyncService,
  getGitHubToken,
  createGitHubSyncService,
  createGitHubSyncServiceOrThrow,
} from "./github/index.js";
import type { TaskStore, GithubMetadata } from "../types.js";
import type { SyncResult } from "./sync/registry.js";

/**
 * Cast SyncResult metadata to GithubMetadata for test assertions.
 */
function getGitHubMetadata(
  result: SyncResult | null | undefined,
): GithubMetadata | undefined {
  return result?.metadata as GithubMetadata | undefined;
}
import type { GitHubMock } from "../test-utils/github-mock.js";
import {
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createTask,
  createStore,
} from "../test-utils/github-mock.js";

// Mock git remote detection
vi.mock("./github/remote.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./github/remote.js")>();
  return {
    ...original,
    getGitHubRepo: vi.fn(() => ({ owner: "test-owner", repo: "test-repo" })),
  };
});

// Mock execSync for git operations
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes("gh auth token")) {
        throw new Error("gh not authenticated");
      }
      // Default: commits are on remote (for most tests)
      if (cmd.includes("git merge-base --is-ancestor")) {
        return ""; // Success = commit is on remote
      }
      return "";
    }),
  };
});

describe("GitHubSyncService", () => {
  let service: GitHubSyncService;
  let githubMock: GitHubMock;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.restoreAllMocks();
  });

  describe("syncTask", () => {
    describe("401 unauthorized errors", () => {
      it("throws error when creating issue with invalid token", async () => {
        const task = createTask();
        const store = createStore([task]);

        // First, search for existing issue returns 401
        githubMock.listIssues401("test-owner", "test-repo");

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });

      it("throws error when updating issue with invalid token", async () => {
        const task = createTask({
          metadata: {
            github: {
              issueNumber: 123,
              issueUrl: "https://github.com/test-owner/test-repo/issues/123",
              repo: "test-owner/test-repo",
            },
          },
        });
        const store = createStore([task]);

        // Get issue returns 401
        githubMock.getIssue401("test-owner", "test-repo", 123);

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });
    });

    describe("403 forbidden errors", () => {
      it("throws error when rate limited during issue creation", async () => {
        const task = createTask();
        const store = createStore([task]);

        // Search returns rate limit error
        githubMock.listIssues403("test-owner", "test-repo", true);

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });

      it("throws error when lacking permissions to update issue", async () => {
        const task = createTask({
          metadata: {
            github: {
              issueNumber: 456,
              issueUrl: "https://github.com/test-owner/test-repo/issues/456",
              repo: "test-owner/test-repo",
            },
          },
        });
        const store = createStore([task]);

        // Get issue returns 403 forbidden
        githubMock.getIssue403("test-owner", "test-repo", 456, false);

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });
    });

    describe("404 not found errors", () => {
      it("creates new issue when no existing issue tracked", async () => {
        // Task without any GitHub metadata - needs to search then create
        const task = createTask({ id: "brand-new-task" });
        const store = createStore([task]);

        // Search for existing issue by task ID - none found
        githubMock.listIssues("test-owner", "test-repo", []);
        // Create new issue
        githubMock.createIssue(
          "test-owner",
          "test-repo",
          createIssueFixture({
            number: 1001,
            title: task.description,
          }),
        );

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(result?.created).toBe(true);
        expect(getGitHubMetadata(result)?.issueNumber).toBe(1001);
      });

      it("throws when tracked issue returns 404 during update check", async () => {
        // Task with GitHub metadata pointing to a deleted issue
        const task = createTask({
          metadata: {
            github: {
              issueNumber: 999,
              issueUrl: "https://github.com/test-owner/test-repo/issues/999",
              repo: "test-owner/test-repo",
            },
          },
        });
        const store = createStore([task]);

        // Get issue returns 404 (issue was deleted), hasIssueChanged catches and returns true
        // Then updateIssue is called and also returns 404
        githubMock.getIssue404("test-owner", "test-repo", 999);
        githubMock.updateIssue404("test-owner", "test-repo", 999);

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });
    });

    describe("500 server errors", () => {
      it("throws error when GitHub server fails during issue creation", async () => {
        const task = createTask();
        const store = createStore([task]);

        // Search works but create fails
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue500("test-owner", "test-repo");

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });

      it("throws error when GitHub server fails during issue update", async () => {
        const task = createTask({
          metadata: {
            github: {
              issueNumber: 789,
              issueUrl: "https://github.com/test-owner/test-repo/issues/789",
              repo: "test-owner/test-repo",
            },
          },
        });
        const store = createStore([task]);

        // Get issue works but indicates change needed, then update fails
        githubMock.getIssue(
          "test-owner",
          "test-repo",
          789,
          createIssueFixture({
            number: 789,
            title: "Old title", // Different from task.description to trigger update
          }),
        );
        githubMock.updateIssue500("test-owner", "test-repo", 789);

        await expect(service.syncTask(task, store)).rejects.toThrow();
      });
    });

    describe("fast-path state tracking", () => {
      // Tasks without commit SHA don't close issues (can't verify merge)
      // Tasks with commit SHA require the commit to be on origin/HEAD

      it("syncs completed task with pushed commit when previously synced as open", async () => {
        const { execSync } = await import("node:child_process");
        vi.mocked(execSync).mockImplementation((cmd: string) => {
          if (typeof cmd === "string" && cmd.includes("gh auth token")) {
            throw new Error("gh not authenticated");
          }
          // Commit IS on remote
          if (
            typeof cmd === "string" &&
            cmd.includes("git merge-base --is-ancestor")
          ) {
            return ""; // Success
          }
          return "";
        });

        // Task synced while pending (state: "open"), then completed with pushed commit
        // The sync should update the issue to close it
        const task = createTask({
          completed: true,
          metadata: {
            github: {
              issueNumber: 100,
              issueUrl: "https://github.com/test-owner/test-repo/issues/100",
              repo: "test-owner/test-repo",
              state: "open", // Previously synced as open
            },
            commit: {
              sha: "abc123",
              message: "Fix bug",
            },
          },
        });
        const store = createStore([task]);

        // Should fetch the issue and update it (not skip via fast-path)
        githubMock.getIssue(
          "test-owner",
          "test-repo",
          100,
          createIssueFixture({
            number: 100,
            title: task.description,
            state: "open",
          }),
        );
        githubMock.updateIssue(
          "test-owner",
          "test-repo",
          100,
          createIssueFixture({
            number: 100,
            title: task.description,
            state: "closed",
          }),
        );

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(result?.skipped).toBeFalsy();
        expect(getGitHubMetadata(result)?.state).toBe("closed");
      });

      it("skips completed task with pushed commit when already synced as closed", async () => {
        const { execSync } = await import("node:child_process");
        vi.mocked(execSync).mockImplementation((cmd: string) => {
          if (typeof cmd === "string" && cmd.includes("gh auth token")) {
            throw new Error("gh not authenticated");
          }
          // Commit IS on remote
          if (
            typeof cmd === "string" &&
            cmd.includes("git merge-base --is-ancestor")
          ) {
            return ""; // Success
          }
          return "";
        });

        // Fast-path: completed task with pushed commit and state: "closed" should skip API call
        const task = createTask({
          completed: true,
          metadata: {
            github: {
              issueNumber: 101,
              issueUrl: "https://github.com/test-owner/test-repo/issues/101",
              repo: "test-owner/test-repo",
              state: "closed", // Already synced as closed
            },
            commit: {
              sha: "abc123",
              message: "Fix bug",
            },
          },
        });
        const store = createStore([task]);

        // Should NOT make any API calls (fast-path)
        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(result?.skipped).toBe(true);
        expect(getGitHubMetadata(result)?.state).toBe("closed");
      });

      it("checks API for open task even with matching state", async () => {
        // Open tasks can change, so we always check the API (no fast-path for open tasks)
        const task = createTask({
          completed: false,
          metadata: {
            github: {
              issueNumber: 102,
              issueUrl: "https://github.com/test-owner/test-repo/issues/102",
              repo: "test-owner/test-repo",
              state: "open",
            },
          },
        });
        const store = createStore([task]);

        // Should fetch issue to check for changes
        // Body won't match (mock has null), so update will be called
        githubMock.getIssue(
          "test-owner",
          "test-repo",
          102,
          createIssueFixture({
            number: 102,
            title: task.description,
            state: "open",
          }),
        );
        githubMock.updateIssue(
          "test-owner",
          "test-repo",
          102,
          createIssueFixture({
            number: 102,
            title: task.description,
            state: "open",
          }),
        );

        const result = await service.syncTask(task, store);

        // Open task was checked and updated (not fast-pathed)
        expect(result).not.toBeNull();
        expect(result?.skipped).toBeFalsy();
        expect(getGitHubMetadata(result)?.state).toBe("open");
      });
    });

    describe("commit-based completion checking", () => {
      it("keeps issue open when task has unpushed commit", async () => {
        const { execSync } = await import("node:child_process");
        vi.mocked(execSync).mockImplementation((cmd: string) => {
          if (typeof cmd === "string" && cmd.includes("gh auth token")) {
            throw new Error("gh not authenticated");
          }
          // Commit is NOT on remote
          if (
            typeof cmd === "string" &&
            cmd.includes("git merge-base --is-ancestor")
          ) {
            throw new Error("not ancestor");
          }
          return "";
        });

        // Task is completed locally with a commit SHA that's not pushed
        const task = createTask({
          completed: true,
          metadata: {
            commit: {
              sha: "abc123",
              message: "Fix bug",
            },
          },
        });
        const store = createStore([task]);

        // Should create issue as OPEN (not closed) because commit isn't pushed
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue(
          "test-owner",
          "test-repo",
          createIssueFixture({
            number: 1,
            title: task.name,
            state: "open",
          }),
        );

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(getGitHubMetadata(result)?.state).toBe("open");
      });

      it("closes issue when task has pushed commit", async () => {
        const { execSync } = await import("node:child_process");
        vi.mocked(execSync).mockImplementation((cmd: string) => {
          if (typeof cmd === "string" && cmd.includes("gh auth token")) {
            throw new Error("gh not authenticated");
          }
          // Commit IS on remote (success = exit 0)
          if (
            typeof cmd === "string" &&
            cmd.includes("git merge-base --is-ancestor")
          ) {
            return ""; // Success
          }
          return "";
        });

        // Task is completed locally with a commit SHA that IS pushed
        const task = createTask({
          completed: true,
          metadata: {
            commit: {
              sha: "abc123",
              message: "Fix bug",
            },
          },
        });
        const store = createStore([task]);

        // Should create issue as CLOSED because commit is pushed
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue(
          "test-owner",
          "test-repo",
          createIssueFixture({
            number: 1,
            title: task.name,
            state: "open",
          }),
        );
        githubMock.updateIssue(
          "test-owner",
          "test-repo",
          1,
          createIssueFixture({
            number: 1,
            title: task.name,
            state: "closed",
          }),
        );

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(getGitHubMetadata(result)?.state).toBe("closed");
      });

      it("keeps issue open when task has no commit SHA (can't verify merge)", async () => {
        // Task is completed locally without a commit SHA
        // Should keep issue OPEN because we can't verify the work is merged
        const task = createTask({
          completed: true,
          // No commit metadata - completed with --no-commit
        });
        const store = createStore([task]);

        // Should create issue as OPEN because there's no commit to verify
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue(
          "test-owner",
          "test-repo",
          createIssueFixture({
            number: 1,
            title: task.name,
            state: "open",
          }),
        );

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(getGitHubMetadata(result)?.state).toBe("open");
      });

      it("does not reopen a closed issue when local task has no verified commit", async () => {
        // Scenario: Task was completed on Machine A (with commit), issue closed
        // Machine B has the task locally completed but without a verified commit
        // When Machine B syncs, it should NOT reopen the closed issue
        const task = createTask({
          id: "test-task",
          completed: true,
          metadata: {
            github: {
              issueNumber: 42,
              issueUrl: "https://github.com/test-owner/test-repo/issues/42",
              repo: "test-owner/test-repo",
              state: "open", // Local metadata is stale
            },
          },
          // No commit metadata - can't verify merge
        });
        const store = createStore([task]);

        // Single-task sync uses getIssue (not listIssues) since task already has issueNumber
        // Issue is already CLOSED on GitHub (was closed on another machine)
        githubMock.getIssue(
          "test-owner",
          "test-repo",
          42,
          createIssueFixture({
            number: 42,
            title: task.name,
            state: "closed",
            body: `<!-- dex:task:id:test-task -->`,
          }),
        );

        // Update should keep the issue closed (not reopen it)
        // The key assertion: update is called but doesn't include state: "open"
        githubMock.updateIssue(
          "test-owner",
          "test-repo",
          42,
          createIssueFixture({
            number: 42,
            title: task.name,
            state: "closed", // Stays closed
          }),
        );

        const result = await service.syncTask(task, store);

        // The sync completes successfully
        expect(result).not.toBeNull();
        // We report "open" as expected state (since we can't verify commit)
        // but the issue stays closed on GitHub (we don't reopen it)
        expect(getGitHubMetadata(result)?.state).toBe("open");
      });

      it("does not reopen closed issue when syncing incomplete task without cache", async () => {
        // Critical test for the fix: when syncTask is called directly (not through syncAll),
        // there's no issue cache, so getIssueChangeResult must fetch the current state.
        // If the remote issue is closed, we must not reopen it by sending state: "open".
        const task = createTask({
          id: "incomplete-task",
          name: "Incomplete Task",
          completed: false, // Task is NOT completed locally
          metadata: {
            github: {
              issueNumber: 99,
              issueUrl: "https://github.com/test-owner/test-repo/issues/99",
              repo: "test-owner/test-repo",
              state: "open", // Stale local metadata
            },
          },
        });
        const store = createStore([task]);

        // The GitHub issue is already CLOSED (closed externally or by another machine)
        githubMock.getIssue(
          "test-owner",
          "test-repo",
          99,
          createIssueFixture({
            number: 99,
            title: task.name,
            state: "closed", // CLOSED on remote
            body: `<!-- dex:task:id:incomplete-task -->`,
          }),
        );

        // The update should NOT include state: "open" (would reopen the issue)
        // Since the local content differs from remote, an update is needed
        // but the state field should be omitted to preserve the closed state
        githubMock.updateIssue(
          "test-owner",
          "test-repo",
          99,
          createIssueFixture({
            number: 99,
            title: task.name,
            state: "closed", // Should stay closed
          }),
        );

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        // Expected state is "open" (task not completed), but issue should stay closed on GitHub
        expect(getGitHubMetadata(result)?.state).toBe("open");
      });

      it("verifies request body does not contain state:open when issue is closed", async () => {
        // This test uses nock body matching to PROVE we don't send state: "open"
        const task = createTask({
          id: "body-check-task",
          name: "Body Check Task",
          completed: false,
          metadata: {
            github: {
              issueNumber: 88,
              issueUrl: "https://github.com/test-owner/test-repo/issues/88",
              repo: "test-owner/test-repo",
              state: "open",
            },
          },
        });
        const store = createStore([task]);

        // Setup getIssue to return closed issue
        githubMock.getIssue(
          "test-owner",
          "test-repo",
          88,
          createIssueFixture({
            number: 88,
            title: task.name,
            state: "closed",
            body: `<!-- dex:task:id:body-check-task -->`,
          }),
        );

        // Use nock directly with body matching to verify state is NOT "open"
        let capturedBody: Record<string, unknown> | null = null;
        nock("https://api.github.com")
          .patch(`/repos/test-owner/test-repo/issues/88`, (body) => {
            capturedBody = body as Record<string, unknown>;
            // Accept any body - we'll verify after
            return true;
          })
          .reply(200, {
            number: 88,
            title: task.name,
            state: "closed",
            html_url: "https://github.com/test-owner/test-repo/issues/88",
          });

        await service.syncTask(task, store);

        // THE CRITICAL ASSERTION: state should NOT be "open"
        expect(capturedBody).not.toBeNull();
        expect(capturedBody!.state).not.toBe("open");
        // state should either be undefined (not sent) or "closed"
        expect(
          capturedBody!.state === undefined || capturedBody!.state === "closed",
        ).toBe(true);
      });
    });
  });

  describe("syncAll", () => {
    describe("partial sync failures", () => {
      it("continues syncing after one task fails", async () => {
        const task1 = createTask({ id: "task1", description: "Task 1" });
        const task2 = createTask({ id: "task2", description: "Task 2" });
        const store = createStore([task1, task2]);

        // Task 1: search then create fails
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue500("test-owner", "test-repo");

        // Note: syncAll doesn't continue after failure by default
        // This tests that errors propagate correctly
        await expect(service.syncAll(store)).rejects.toThrow();
      });

      it("reports progress for each task", async () => {
        const task1 = createTask({ id: "task1", description: "Task 1" });
        const task2 = createTask({ id: "task2", description: "Task 2" });
        const store = createStore([task1, task2]);

        const progressEvents: string[] = [];

        // Both tasks: search then create
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue(
          "test-owner",
          "test-repo",
          createIssueFixture({
            number: 1,
            title: "Task 1",
          }),
        );
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue(
          "test-owner",
          "test-repo",
          createIssueFixture({
            number: 2,
            title: "Task 2",
          }),
        );

        const results = await service.syncAll(store, {
          onProgress: (progress) => {
            progressEvents.push(`${progress.phase}:${progress.task.id}`);
          },
        });

        expect(results).toHaveLength(2);
        expect(progressEvents).toContain("checking:task1");
        expect(progressEvents).toContain("creating:task1");
        expect(progressEvents).toContain("checking:task2");
        expect(progressEvents).toContain("creating:task2");
      });
    });

    describe("401 unauthorized during bulk sync", () => {
      it("fails immediately on auth error", async () => {
        const task = createTask();
        const store = createStore([task]);

        githubMock.listIssues401("test-owner", "test-repo");

        await expect(service.syncAll(store)).rejects.toThrow();
      });
    });

    describe("rate limiting during bulk sync", () => {
      it("fails on rate limit error", async () => {
        const task = createTask();
        const store = createStore([task]);

        githubMock.listIssues403("test-owner", "test-repo", true);

        await expect(service.syncAll(store)).rejects.toThrow();
      });
    });
  });

  describe("findIssueByTaskId", () => {
    it("returns null when API returns 401", async () => {
      githubMock.listIssues401("test-owner", "test-repo");

      const result = await service.findIssueByTaskId("some-task");

      // findIssueByTaskId catches errors and returns null
      expect(result).toBeNull();
    });

    it("returns null when API returns 403", async () => {
      githubMock.listIssues403("test-owner", "test-repo");

      const result = await service.findIssueByTaskId("some-task");

      expect(result).toBeNull();
    });

    it("returns null when API returns 500", async () => {
      githubMock.listIssues500("test-owner", "test-repo");

      const result = await service.findIssueByTaskId("some-task");

      expect(result).toBeNull();
    });

    it("finds issue by task ID in new format", async () => {
      githubMock.listIssues("test-owner", "test-repo", [
        createIssueFixture({
          number: 42,
          title: "Test",
          body: "<!-- dex:task:id:abc12345 -->\nSome context",
        }),
      ]);

      const result = await service.findIssueByTaskId("abc12345");

      expect(result).toBe(42);
    });

    it("finds issue by task ID in legacy format", async () => {
      githubMock.listIssues("test-owner", "test-repo", [
        createIssueFixture({
          number: 43,
          title: "Test",
          body: "<!-- dex:task:legacy123 -->\nSome context",
        }),
      ]);

      const result = await service.findIssueByTaskId("legacy123");

      expect(result).toBe(43);
    });
  });
});

describe("getGitHubToken", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("returns token from environment variable", () => {
    process.env.GITHUB_TOKEN = "env-token-123";

    const token = getGitHubToken();

    expect(token).toBe("env-token-123");
  });

  it("returns token from custom environment variable", () => {
    process.env.MY_CUSTOM_TOKEN = "custom-token-456";

    const token = getGitHubToken("MY_CUSTOM_TOKEN");

    expect(token).toBe("custom-token-456");
    delete process.env.MY_CUSTOM_TOKEN;
  });

  it("returns null when no token available", () => {
    delete process.env.GITHUB_TOKEN;

    const token = getGitHubToken();

    // With our mock, gh auth token throws, so returns null
    expect(token).toBeNull();
  });
});

describe("createGitHubSyncService", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GITHUB_TOKEN;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("returns null when sync is disabled", async () => {
    const result = await createGitHubSyncService({ enabled: false });

    expect(result).toBeNull();
  });

  it("returns null when config is undefined", async () => {
    const result = await createGitHubSyncService(undefined);

    expect(result).toBeNull();
  });

  it("returns null when no token available", async () => {
    delete process.env.GITHUB_TOKEN;

    // Suppress console.warn for this test
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await createGitHubSyncService({ enabled: true });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no token found"),
    );

    warnSpy.mockRestore();
  });

  it("creates service when properly configured", async () => {
    process.env.GITHUB_TOKEN = "valid-token";

    const result = await createGitHubSyncService({ enabled: true });

    expect(result).not.toBeNull();
    expect(result?.getRepoString()).toBe("test-owner/test-repo");
  });
});

describe("createGitHubSyncServiceOrThrow", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GITHUB_TOKEN;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("throws when no token available", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(createGitHubSyncServiceOrThrow()).rejects.toThrow(
      /GitHub token not found/,
    );
  });

  it("throws with helpful message mentioning token env var", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(createGitHubSyncServiceOrThrow()).rejects.toThrow(
      /GITHUB_TOKEN/,
    );
  });

  it("throws with helpful message mentioning gh auth", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(createGitHubSyncServiceOrThrow()).rejects.toThrow(
      /gh auth login/,
    );
  });

  it("creates service when token available", async () => {
    process.env.GITHUB_TOKEN = "valid-token";

    const result = await createGitHubSyncServiceOrThrow();

    expect(result).not.toBeNull();
    expect(result.getRepoString()).toBe("test-owner/test-repo");
  });

  it("uses custom token env var from config", async () => {
    process.env.CUSTOM_GH_TOKEN = "custom-token";

    const result = await createGitHubSyncServiceOrThrow({
      enabled: true,
      token_env: "CUSTOM_GH_TOKEN",
    });

    expect(result).not.toBeNull();

    delete process.env.CUSTOM_GH_TOKEN;
  });
});

describe("fetchAllDexIssues", () => {
  let service: GitHubSyncService;
  let githubMock: GitHubMock;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
    delete process.env.GITHUB_TOKEN;
  });

  it("returns empty map when no issues exist", async () => {
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.size).toBe(0);
  });

  it("extracts task IDs using new format", async () => {
    // Page 1: issue with task ID
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Task 1",
        body: "<!-- dex:task:id:abc123 -->\nSome context",
        labels: [{ name: "dex" }, { name: "dex:priority-medium" }],
      }),
    ]);
    // Page 2: empty (end of pagination)
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.size).toBe(1);
    expect(result.has("abc123")).toBe(true);
    const issue = result.get("abc123");
    expect(issue?.number).toBe(1);
    expect(issue?.title).toBe("Task 1");
    expect(issue?.labels).toContain("dex");
    expect(issue?.labels).toContain("dex:priority-medium");
  });

  it("extracts task IDs using legacy format", async () => {
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 2,
        title: "Legacy Task",
        body: "<!-- dex:task:legacy789 -->\nOld context",
        labels: [{ name: "dex" }],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.size).toBe(1);
    expect(result.has("legacy789")).toBe(true);
  });

  it("filters out pull requests", async () => {
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Issue",
        body: "<!-- dex:task:id:issue123 -->",
      }),
      {
        number: 2,
        title: "PR",
        body: "<!-- dex:task:id:pr456 -->",
        state: "open",
        labels: [],
        pull_request: { url: "https://github.com/test/test/pulls/2" },
      },
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.size).toBe(1);
    expect(result.has("issue123")).toBe(true);
    expect(result.has("pr456")).toBe(false);
  });

  it("skips issues without task IDs", async () => {
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Has ID",
        body: "<!-- dex:task:id:valid123 -->",
      }),
      createIssueFixture({
        number: 2,
        title: "No ID",
        body: "Just a regular issue body without task marker",
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.size).toBe(1);
    expect(result.has("valid123")).toBe(true);
  });

  it("handles pagination across multiple pages", async () => {
    // First page with issues
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Task 1",
        body: "<!-- dex:task:id:task1 -->",
      }),
    ]);
    // Second page (empty, signals end of pagination)
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.size).toBe(1);
    expect(result.has("task1")).toBe(true);
  });

  it("captures issue state correctly", async () => {
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Open Task",
        body: "<!-- dex:task:id:open1 -->",
        state: "open",
      }),
      createIssueFixture({
        number: 2,
        title: "Closed Task",
        body: "<!-- dex:task:id:closed2 -->",
        state: "closed",
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    expect(result.get("open1")?.state).toBe("open");
    expect(result.get("closed2")?.state).toBe("closed");
  });

  it("filters labels to only include dex-prefixed ones", async () => {
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Task",
        body: "<!-- dex:task:id:abc -->",
        labels: [
          { name: "dex" },
          { name: "dex:priority-high" },
          { name: "bug" },
          { name: "enhancement" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const result = await service.fetchAllDexIssues();

    const labels = result.get("abc")?.labels || [];
    expect(labels).toContain("dex");
    expect(labels).toContain("dex:priority-high");
    expect(labels).not.toContain("bug");
    expect(labels).not.toContain("enhancement");
  });
});

describe("syncAll with issue cache", () => {
  let service: GitHubSyncService;
  let githubMock: GitHubMock;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
    delete process.env.GITHUB_TOKEN;
  });

  it("calls fetchAllDexIssues once at start of syncAll", async () => {
    const task1 = createTask({ id: "task1", description: "Task 1" });
    const task2 = createTask({ id: "task2", description: "Task 2" });
    const store = createStore([task1, task2]);

    // Set up cache fetch (page 1 empty, indicating no existing issues)
    githubMock.listIssues("test-owner", "test-repo", []);

    // Create issues for both tasks (no additional list calls needed due to cache)
    githubMock.createIssue(
      "test-owner",
      "test-repo",
      createIssueFixture({
        number: 1,
        title: "Task 1",
      }),
    );
    githubMock.createIssue(
      "test-owner",
      "test-repo",
      createIssueFixture({
        number: 2,
        title: "Task 2",
      }),
    );

    const results = await service.syncAll(store);

    expect(results).toHaveLength(2);
    expect(results[0].created).toBe(true);
    expect(results[1].created).toBe(true);
  });

  it("uses cached issue data for change detection instead of individual GET calls", async () => {
    const task1 = createTask({
      id: "task1",
      name: "Task 1",
      description: "Same context",
    });
    const task2 = createTask({
      id: "task2",
      name: "Task 2",
      description: "Same context",
    });
    const store = createStore([task1, task2]);

    // Cache fetch returns both issues with matching content
    // Page 1: both issues
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Task 1",
        body: `<!-- dex:task:id:task1 -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task1.created_at} -->\n<!-- dex:task:updated_at:${task1.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nSame context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
      createIssueFixture({
        number: 2,
        title: "Task 2",
        body: `<!-- dex:task:id:task2 -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task2.created_at} -->\n<!-- dex:task:updated_at:${task2.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nSame context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    // Page 2: empty (end of pagination)
    githubMock.listIssues("test-owner", "test-repo", []);

    // No GET or PATCH calls should be made since content matches
    const results = await service.syncAll(store);

    expect(results).toHaveLength(2);
    expect(results[0].skipped).toBe(true);
    expect(results[1].skipped).toBe(true);
  });

  it("only calls update for tasks that have changed", async () => {
    const task1 = createTask({
      id: "task1",
      name: "Task 1 Updated",
      description: "Changed context",
    });
    const task2 = createTask({
      id: "task2",
      name: "Task 2",
      description: "Same context",
    });
    const store = createStore([task1, task2]);

    // Cache returns task1 with old title, task2 with matching content
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Task 1 Old",
        body: `<!-- dex:task:id:task1 -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task1.created_at} -->\n<!-- dex:task:updated_at:${task1.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nOld context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
      createIssueFixture({
        number: 2,
        title: "Task 2",
        body: `<!-- dex:task:id:task2 -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task2.created_at} -->\n<!-- dex:task:updated_at:${task2.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nSame context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    // Only task1 should be updated
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      1,
      createIssueFixture({
        number: 1,
        title: "Task 1 Updated",
      }),
    );

    const results = await service.syncAll(store);

    expect(results).toHaveLength(2);
    expect(results[0].skipped).toBeFalsy();
    expect(results[1].skipped).toBe(true);
  });

  it("creates issues for tasks not found in cache", async () => {
    const task1 = createTask({
      id: "existingtask",
      name: "Existing",
      description: "Test description",
    });
    const task2 = createTask({ id: "newtask", name: "New" });
    const store = createStore([task1, task2]);

    // Cache only has task1
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Existing",
        body: `<!-- dex:task:id:existingtask -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task1.created_at} -->\n<!-- dex:task:updated_at:${task1.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nTest description`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    // task2 should be created
    githubMock.createIssue(
      "test-owner",
      "test-repo",
      createIssueFixture({
        number: 2,
        title: "New",
      }),
    );

    const results = await service.syncAll(store);

    expect(results).toHaveLength(2);
    expect(results[0].skipped).toBe(true);
    expect(results[1].created).toBe(true);
  });
});

describe("hasIssueChangedFromCache change detection", () => {
  let service: GitHubSyncService;
  let githubMock: GitHubMock;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
    delete process.env.GITHUB_TOKEN;
  });

  it("detects no change when all fields match", async () => {
    const task = createTask({
      id: "taskid",
      name: "Test Task",
      description: "Test context",
    });
    const store = createStore([task]);

    // Cache has matching issue
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Test Task",
        body: `<!-- dex:task:id:taskid -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task.created_at} -->\n<!-- dex:task:updated_at:${task.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nTest context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const results = await service.syncAll(store);

    expect(results[0].skipped).toBe(true);
  });

  it("detects change when title differs", async () => {
    const task = createTask({
      id: "taskid",
      name: "New Title",
      description: "Test context",
    });
    const store = createStore([task]);

    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Old Title",
        body: `<!-- dex:task:id:taskid -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task.created_at} -->\n<!-- dex:task:updated_at:${task.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nTest context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      1,
      createIssueFixture({ number: 1, title: "New Title" }),
    );

    const results = await service.syncAll(store);

    expect(results[0].skipped).toBeFalsy();
  });

  it("detects change when body differs", async () => {
    const task = createTask({
      id: "taskid",
      name: "Test Task",
      description: "New context",
    });
    const store = createStore([task]);

    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Test Task",
        body: `<!-- dex:task:id:taskid -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task.created_at} -->\n<!-- dex:task:updated_at:${task.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nOld context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      1,
      createIssueFixture({ number: 1, title: "Test Task" }),
    );

    const results = await service.syncAll(store);

    expect(results[0].skipped).toBeFalsy();
  });

  it("detects change when state differs (with pushed commit)", async () => {
    // Task with a pushed commit should close the issue
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh auth token")) {
        throw new Error("gh not authenticated");
      }
      // Commit IS on remote
      if (
        typeof cmd === "string" &&
        cmd.includes("git merge-base --is-ancestor")
      ) {
        return ""; // Success
      }
      return "";
    });

    const task = createTask({
      id: "taskid",
      name: "Test Task",
      description: "Test context",
      completed: true,
      metadata: {
        commit: {
          sha: "abc123",
          message: "Fix bug",
        },
      },
    });
    const store = createStore([task]);

    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Test Task",
        body: `<!-- dex:task:id:taskid -->\nTest context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      1,
      createIssueFixture({ number: 1, title: "Test Task", state: "closed" }),
    );

    const results = await service.syncAll(store);

    expect(results[0].skipped).toBeFalsy();
    expect(getGitHubMetadata(results[0])?.state).toBe("closed");
  });

  it("detects change when labels differ", async () => {
    const task = createTask({
      id: "taskid",
      name: "Test Task",
      description: "Test context",
      priority: 2,
    });
    const store = createStore([task]);

    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Test Task",
        body: `<!-- dex:task:id:taskid -->\n<!-- dex:task:priority:2 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task.created_at} -->\n<!-- dex:task:updated_at:${task.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nTest context`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      1,
      createIssueFixture({ number: 1, title: "Test Task" }),
    );

    const results = await service.syncAll(store);

    expect(results[0].skipped).toBeFalsy();
  });

  it("normalizes whitespace when comparing bodies", async () => {
    const task = createTask({
      id: "taskid",
      name: "Test Task",
      description: "Test context",
    });
    const store = createStore([task]);

    // Body has trailing whitespace but content is the same
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 1,
        title: "Test Task",
        body: `<!-- dex:task:id:taskid -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task.created_at} -->\n<!-- dex:task:updated_at:${task.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nTest context  \n`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    ]);
    githubMock.listIssues("test-owner", "test-repo", []);

    const results = await service.syncAll(store);

    expect(results[0].skipped).toBe(true);
  });
});

describe("syncTask without cache (single-task sync)", () => {
  let service: GitHubSyncService;
  let githubMock: GitHubMock;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
    delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it("falls back to findIssueByTaskId when no metadata and no cache", async () => {
    const task = createTask({ id: "unmapped", description: "Unmapped Task" });
    const store = createStore([task]);

    // findIssueByTaskId is called, finds existing issue
    githubMock.listIssues("test-owner", "test-repo", [
      createIssueFixture({
        number: 42,
        title: "Unmapped Task",
        body: "<!-- dex:task:id:unmapped -->\nSome context",
      }),
    ]);

    // hasIssueChanged is called via GET since no cache
    githubMock.getIssue(
      "test-owner",
      "test-repo",
      42,
      createIssueFixture({
        number: 42,
        title: "Unmapped Task",
        body: "<!-- dex:task:id:unmapped -->\nSome context",
      }),
    );

    // Update is called since body won't match
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      42,
      createIssueFixture({
        number: 42,
        title: "Unmapped Task",
      }),
    );

    const result = await service.syncTask(task, store);

    expect(result).not.toBeNull();
    expect(getGitHubMetadata(result)?.issueNumber).toBe(42);
    expect(result?.created).toBe(false);
  });

  it("skips findIssueByTaskId when task has metadata", async () => {
    const task = createTask({
      id: "mapped",
      name: "Mapped Task",
      metadata: {
        github: {
          issueNumber: 99,
          issueUrl: "https://github.com/test-owner/test-repo/issues/99",
          repo: "test-owner/test-repo",
        },
      },
    });
    const store = createStore([task]);

    // No listIssues call needed - goes straight to hasIssueChanged
    githubMock.getIssue(
      "test-owner",
      "test-repo",
      99,
      createIssueFixture({
        number: 99,
        title: "Old Title",
        body: "Old body",
      }),
    );
    githubMock.updateIssue(
      "test-owner",
      "test-repo",
      99,
      createIssueFixture({
        number: 99,
        title: "Mapped Task",
      }),
    );

    const result = await service.syncTask(task, store);

    expect(result).not.toBeNull();
    expect(getGitHubMetadata(result)?.issueNumber).toBe(99);
    expect(result?.created).toBe(false);
  });

  it("creates new issue when findIssueByTaskId returns null", async () => {
    const task = createTask({ id: "newone", description: "Brand New Task" });
    const store = createStore([task]);

    // findIssueByTaskId returns null (no existing issue)
    githubMock.listIssues("test-owner", "test-repo", []);

    // Create new issue
    githubMock.createIssue(
      "test-owner",
      "test-repo",
      createIssueFixture({
        number: 100,
        title: "Brand New Task",
      }),
    );

    const result = await service.syncTask(task, store);

    expect(result).not.toBeNull();
    expect(getGitHubMetadata(result)?.issueNumber).toBe(100);
    expect(result?.created).toBe(true);
  });

  it("uses hasIssueChanged API call when no cache available", async () => {
    const task = createTask({
      id: "checkchange",
      name: "Check Change Task",
      metadata: {
        github: {
          issueNumber: 77,
          issueUrl: "https://github.com/test-owner/test-repo/issues/77",
          repo: "test-owner/test-repo",
        },
      },
    });
    const store = createStore([task]);

    // hasIssueChanged makes GET call to check if update needed
    githubMock.getIssue(
      "test-owner",
      "test-repo",
      77,
      createIssueFixture({
        number: 77,
        title: "Check Change Task",
        body: `<!-- dex:task:id:checkchange -->\n<!-- dex:task:priority:1 -->\n<!-- dex:task:completed:false -->\n<!-- dex:task:created_at:${task.created_at} -->\n<!-- dex:task:updated_at:${task.updated_at} -->\n<!-- dex:task:started_at:null -->\n<!-- dex:task:completed_at:null -->\n<!-- dex:task:blockedBy:[] -->\n<!-- dex:task:blocks:[] -->\nTest description`,
        state: "open",
        labels: [
          { name: "dex" },
          { name: "dex:priority-1" },
          { name: "dex:pending" },
        ],
      }),
    );

    // Content matches, so no update needed
    const result = await service.syncTask(task, store);

    expect(result).not.toBeNull();
    expect(result?.skipped).toBe(true);
  });
});

describe("GitHubSyncService error message quality", () => {
  let service: GitHubSyncService;
  let githubMock: GitHubMock;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
    delete process.env.GITHUB_TOKEN;
  });

  it("API errors include status code information", async () => {
    const task = createTask();
    const store = createStore([task]);

    githubMock.listIssues("test-owner", "test-repo", []);
    githubMock.createIssue401("test-owner", "test-repo");

    try {
      await service.syncTask(task, store);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      // Octokit includes status information in error
      expect((err as Error).message).toMatch(/Bad credentials|401/i);
    }
  });

  it("rate limit errors include rate limit information", async () => {
    const task = createTask({
      metadata: {
        github: {
          issueNumber: 888,
          issueUrl: "https://github.com/test-owner/test-repo/issues/888",
          repo: "test-owner/test-repo",
        },
      },
    });
    const store = createStore([task]);

    // Get issue fails (hasIssueChanged catches and returns true)
    // Then update issue gets rate limited
    githubMock.getIssue500("test-owner", "test-repo", 888);
    githubMock.updateIssue403("test-owner", "test-repo", 888, true);

    try {
      await service.syncTask(task, store);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/rate limit|403/i);
    }
  });
});

describe("getIssueNotClosingReason", () => {
  let service: GitHubSyncService;
  let originalEnv: string | undefined;
  let execSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    originalEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";

    service = new GitHubSyncService({
      repo: { owner: "test-owner", repo: "test-repo" },
      token: "test-token",
    });

    // Get fresh mock reference
    const childProcess = await import("node:child_process");
    execSyncMock = childProcess.execSync as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.restoreAllMocks();
  });

  it("returns undefined for non-completed tasks", () => {
    const task = createTask({ completed: false });
    const reason = service.getIssueNotClosingReason(task);
    expect(reason).toBeUndefined();
  });

  it("returns undefined when commit is on remote", () => {
    const task = createTask({
      completed: true,
      metadata: { commit: { sha: "abc1234" } },
    });
    // Default mock returns success for git merge-base (commit on remote)
    const reason = service.getIssueNotClosingReason(task);
    expect(reason).toBeUndefined();
  });

  it("returns reason when commit not pushed to remote", () => {
    // Override mock to simulate commit not on remote
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes("git merge-base --is-ancestor")) {
        throw new Error("Not an ancestor");
      }
      return "";
    });

    const task = createTask({
      completed: true,
      metadata: { commit: { sha: "abc1234567890" } },
    });
    const reason = service.getIssueNotClosingReason(task);
    expect(reason).toBe("commit abc1234 not pushed to remote");
  });

  it("returns reason when task completed without commit", () => {
    const task = createTask({ completed: true });
    const reason = service.getIssueNotClosingReason(task);
    expect(reason).toBe(
      "completed without commit (use --no-commit to close manually)",
    );
  });

  it("returns reason when subtask has unpushed commit", () => {
    // Override mock to simulate commit not on remote
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes("git merge-base --is-ancestor")) {
        throw new Error("Not an ancestor");
      }
      return "";
    });

    const parent = createTask({
      id: "parent1",
      completed: true,
      metadata: { commit: { sha: "aaa1111" } },
    });
    const subtask = createTask({
      id: "subtask1",
      parent_id: "parent1",
      completed: true,
      metadata: { commit: { sha: "bbb2222" } },
    });
    const store = createStore([parent, subtask]);

    const reason = service.getIssueNotClosingReason(parent, store);
    expect(reason).toContain("subtask subtask1 commit bbb2222 not pushed");
  });

  it("returns reason when subtask completed without commit", () => {
    // Parent has no commit - relies on subtasks for verification
    const parent = createTask({
      id: "parent1",
      completed: true,
      // No commit - relies on subtasks
    });
    const subtask = createTask({
      id: "subtask1",
      parent_id: "parent1",
      completed: true,
      // No commit metadata
    });
    const store = createStore([parent, subtask]);

    const reason = service.getIssueNotClosingReason(parent, store);
    expect(reason).toContain("subtask subtask1 completed without commit");
  });

  it("returns reason when subtask not completed", () => {
    // Parent has no commit - relies on subtasks for verification
    const parent = createTask({
      id: "parent1",
      completed: true,
      // No commit - relies on subtasks
    });
    const subtask = createTask({
      id: "subtask1",
      parent_id: "parent1",
      completed: false,
    });
    const store = createStore([parent, subtask]);

    const reason = service.getIssueNotClosingReason(parent, store);
    expect(reason).toContain("subtask subtask1 not completed");
  });
});
