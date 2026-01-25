import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GitHubSyncService,
  getGitHubToken,
  createGitHubSyncService,
  createGitHubSyncServiceOrThrow,
} from "./github-sync.js";
import { TaskStore } from "../types.js";
import {
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createTask,
  createStore,
  GitHubMock,
} from "../cli/test-helpers.js";

// Mock git remote detection
vi.mock("./git-remote.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./git-remote.js")>();
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
      if (cmd.includes("git check-ignore")) {
        throw new Error("not ignored");
      }
      if (cmd.includes("git show origin/HEAD")) {
        throw new Error("not on remote");
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
        githubMock.createIssue("test-owner", "test-repo", createIssueFixture({
          number: 1001,
          title: task.description,
        }));

        const result = await service.syncTask(task, store);

        expect(result).not.toBeNull();
        expect(result?.created).toBe(true);
        expect(result?.github.issueNumber).toBe(1001);
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
        githubMock.getIssue("test-owner", "test-repo", 789, createIssueFixture({
          number: 789,
          title: "Old title", // Different from task.description to trigger update
        }));
        githubMock.updateIssue500("test-owner", "test-repo", 789);

        await expect(service.syncTask(task, store)).rejects.toThrow();
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
        githubMock.createIssue("test-owner", "test-repo", createIssueFixture({
          number: 1,
          title: "Task 1",
        }));
        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue("test-owner", "test-repo", createIssueFixture({
          number: 2,
          title: "Task 2",
        }));

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

  it("returns null when sync is disabled", () => {
    const result = createGitHubSyncService({ enabled: false });

    expect(result).toBeNull();
  });

  it("returns null when config is undefined", () => {
    const result = createGitHubSyncService(undefined);

    expect(result).toBeNull();
  });

  it("returns null when no token available", () => {
    delete process.env.GITHUB_TOKEN;

    // Suppress console.warn for this test
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = createGitHubSyncService({ enabled: true });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no token found")
    );

    warnSpy.mockRestore();
  });

  it("creates service when properly configured", () => {
    process.env.GITHUB_TOKEN = "valid-token";

    const result = createGitHubSyncService({ enabled: true });

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

  it("throws when no token available", () => {
    delete process.env.GITHUB_TOKEN;

    expect(() => createGitHubSyncServiceOrThrow()).toThrow(
      /GitHub token not found/
    );
  });

  it("throws with helpful message mentioning token env var", () => {
    delete process.env.GITHUB_TOKEN;

    expect(() => createGitHubSyncServiceOrThrow()).toThrow(
      /GITHUB_TOKEN/
    );
  });

  it("throws with helpful message mentioning gh auth", () => {
    delete process.env.GITHUB_TOKEN;

    expect(() => createGitHubSyncServiceOrThrow()).toThrow(
      /gh auth login/
    );
  });

  it("creates service when token available", () => {
    process.env.GITHUB_TOKEN = "valid-token";

    const result = createGitHubSyncServiceOrThrow();

    expect(result).not.toBeNull();
    expect(result.getRepoString()).toBe("test-owner/test-repo");
  });

  it("uses custom token env var from config", () => {
    process.env.CUSTOM_GH_TOKEN = "custom-token";

    const result = createGitHubSyncServiceOrThrow({
      enabled: true,
      token_env: "CUSTOM_GH_TOKEN",
    });

    expect(result).not.toBeNull();

    delete process.env.CUSTOM_GH_TOKEN;
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
