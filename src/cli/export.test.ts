import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCli } from "./index.js";
import type { CliTestFixture, GitHubMock } from "./test-helpers.js";
import {
  createCliTestFixture,
  createTaskAndGetId,
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createTestSyncRegistry,
} from "./test-helpers.js";
import type { SyncRegistry } from "../core/sync/index.js";

// Mock git remote detection
vi.mock("../core/github/remote.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../core/github/remote.js")>();
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

describe("export command", () => {
  let fixture: CliTestFixture;
  let githubMock: GitHubMock;
  let originalEnv: string | undefined;
  let syncRegistry: SyncRegistry;

  beforeEach(() => {
    fixture = createCliTestFixture();
    originalEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();
    syncRegistry = createTestSyncRegistry({ github: {} });
  });

  afterEach(() => {
    fixture.cleanup();
    cleanupGitHubMock();
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  async function createTask(
    name: string,
    opts: { description?: string; parent?: string } = {},
  ): Promise<string> {
    return createTaskAndGetId(fixture, name, {
      description: opts.description ?? "ctx",
      parent: opts.parent,
    });
  }

  /** Run sync with auto-sync disabled to prevent double API calls in tests */
  function runSync(args: string[]): Promise<void> {
    const syncConfig = { github: { auto: { on_change: false } } };
    return runCli(args, { storage: fixture.storage, syncRegistry, syncConfig });
  }

  it.each([["--help"], ["-h"]])("shows help with %s flag", async (flag) => {
    await runCli(["export", flag], { storage: fixture.storage });
    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex export");
    expect(out).toContain("Export tasks to GitHub Issues");
  });

  it("fails when no task IDs provided", async () => {
    await expect(
      runCli(["export"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain(
      "At least one task ID is required",
    );
  });

  it("fails when task not found", async () => {
    githubMock.listIssues("test-owner", "test-repo", []);

    await runCli(["export", "nonexist"], { storage: fixture.storage });

    expect(fixture.output.stderr.join("\n")).toContain("not found");
  });

  describe("dry-run mode", () => {
    it("previews export without creating issues", async () => {
      const taskId = await createTask("Test task", { description: "context" });

      await runCli(["export", taskId, "--dry-run"], {
        storage: fixture.storage,
      });

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Would export");
      expect(out).toContain("test-owner/test-repo");
      expect(out).toContain("[create]");
      expect(out).toContain(taskId);
    });
  });

  describe("export specific task", () => {
    it("exports a task to GitHub", async () => {
      const taskId = await createTask("Task to export", {
        description: "Some context",
      });

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({
          number: 101,
          title: "Task to export",
        }),
      );

      await runCli(["export", taskId], { storage: fixture.storage });

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Exported");
      expect(out).toContain(taskId);
      expect(out).toContain("test-owner/test-repo");
      expect(out).toContain("issues/101");
    });

    it("skips task already synced to GitHub", async () => {
      const taskId = await createTask("Synced task", {
        description: "context",
      });

      // First sync to create GitHub metadata
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({
          number: 42,
          title: "Synced task",
        }),
      );
      await runSync(["sync", taskId]);
      fixture.output.stdout.length = 0;

      // Export should skip because task already has GitHub metadata
      await runCli(["export", taskId], { storage: fixture.storage });

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Skipped");
      expect(out).toContain("already synced");
    });

    it("finds root task when exporting subtask", async () => {
      const parentId = await createTask("Parent task");
      const subtaskId = await createTask("Subtask", { parent: parentId });

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({
          number: 102,
          title: "Parent task",
        }),
      );

      await runCli(["export", subtaskId], { storage: fixture.storage });

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Exported");
      expect(out).toContain(parentId);
    });
  });

  describe("export multiple tasks", () => {
    it("exports multiple tasks with summary", async () => {
      const taskId1 = await createTask("Task 1", { description: "ctx1" });
      const taskId2 = await createTask("Task 2", { description: "ctx2" });

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({ number: 201, title: "Task 1" }),
      );
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({ number: 202, title: "Task 2" }),
      );

      await runCli(["export", taskId1, taskId2], { storage: fixture.storage });

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Exported");
      expect(out).toContain("2 exported");
    });

    it("shows combined summary with skipped tasks", async () => {
      const taskId1 = await createTask("Task 1", { description: "ctx1" });
      const taskId2 = await createTask("Task 2", { description: "ctx2" });

      // Sync first task so it gets skipped
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({ number: 301, title: "Task 1" }),
      );
      await runSync(["sync", taskId1]);
      fixture.output.stdout.length = 0;

      // Export both - first should be skipped, second exported
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({ number: 302, title: "Task 2" }),
      );

      await runCli(["export", taskId1, taskId2], { storage: fixture.storage });

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("1 exported");
      expect(out).toContain("1 skipped");
    });
  });

  describe("error handling", () => {
    it("fails when GitHub token is missing", async () => {
      delete process.env.GITHUB_TOKEN;
      const taskId = await createTask("Task");

      await expect(
        runCli(["export", taskId], { storage: fixture.storage }),
      ).rejects.toThrow("process.exit");
      expect(fixture.output.stderr.join("\n")).toMatch(
        /GitHub token|GITHUB_TOKEN/i,
      );
    });

    it("handles GitHub API error gracefully", async () => {
      const taskId = await createTask("Task");

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue500("test-owner", "test-repo");

      await runCli(["export", taskId], { storage: fixture.storage });

      expect(fixture.output.stderr.join("\n")).toContain("Error");
    });
  });
});
