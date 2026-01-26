import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import {
  captureOutput,
  createTempStorage,
  CapturedOutput,
  TASK_ID_REGEX,
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  GitHubMock,
} from "./test-helpers.js";

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

describe("sync command", () => {
  let storage: FileStorage;
  let cleanup: () => void;
  let output: CapturedOutput;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let githubMock: GitHubMock;
  let originalEnv: string | undefined;

  beforeEach(() => {
    const temp = createTempStorage();
    storage = temp.storage;
    cleanup = temp.cleanup;
    output = captureOutput();
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);

    originalEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";
    githubMock = setupGitHubMock();
  });

  afterEach(() => {
    output.restore();
    cleanup();
    mockExit.mockRestore();
    cleanupGitHubMock();
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.restoreAllMocks();
  });

  /** Helper to create a task and return its ID, clearing output afterward. */
  async function createTask(
    name: string,
    opts: { description?: string; parent?: string } = {},
  ): Promise<string> {
    const args = [
      "create",
      "-n",
      name,
      "--description",
      opts.description ?? "ctx",
    ];
    if (opts.parent) args.push("--parent", opts.parent);
    await runCli(args, { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;
    if (!taskId) throw new Error("Failed to create task");
    return taskId;
  }

  it.each([["--help"], ["-h"]])("shows help with %s flag", async (flag) => {
    await runCli(["sync", flag], { storage });
    const out = output.stdout.join("\n");
    expect(out).toContain("dex sync");
    expect(out).toContain("Push tasks to GitHub Issues");
  });

  it("reports no tasks to sync when empty", async () => {
    await runCli(["sync"], { storage });
    expect(output.stdout.join("\n")).toContain("No tasks to sync");
  });

  describe("dry-run mode", () => {
    it("previews sync without making changes for all tasks", async () => {
      const taskId = await createTask("Test task", { description: "context" });

      await runCli(["sync", "--dry-run"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Would sync");
      expect(out).toContain("test-owner/test-repo");
      expect(out).toContain("[create]");
      expect(out).toContain(taskId);
    });

    it("shows update action for tasks already synced to GitHub", async () => {
      const taskId = await createTask("Synced task", {
        description: "context",
      });

      // Sync to create GitHub metadata
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({
          number: 42,
          title: "Synced task",
        }),
      );
      await runCli(["sync", taskId], { storage });
      output.stdout.length = 0;

      // Dry-run should show update
      await runCli(["sync", "--dry-run"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Would sync");
      expect(out).toContain("[update]");
    });

    it("previews sync for specific task", async () => {
      const taskId = await createTask("Task to sync");

      await runCli(["sync", taskId, "--dry-run"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Would sync");
      expect(out).toContain(taskId);
    });
  });

  describe("sync specific task", () => {
    it("syncs a specific task to GitHub", async () => {
      const taskId = await createTask("Task to sync", {
        description: "Some context",
      });

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({
          number: 101,
          title: "Task to sync",
        }),
      );

      await runCli(["sync", taskId], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain(taskId);
      expect(out).toContain("test-owner/test-repo");
      expect(out).toContain("issues/101");
    });

    it("fails when task not found", async () => {
      await expect(runCli(["sync", "nonexist"], { storage })).rejects.toThrow(
        "process.exit",
      );
      expect(output.stderr.join("\n")).toContain("not found");
    });

    it("syncs subtask by finding root task", async () => {
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

      await runCli(["sync", subtaskId], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain(parentId);
    });
  });

  describe("sync all tasks", () => {
    it("syncs all root tasks to GitHub", async () => {
      await createTask("Task 1", { description: "ctx1" });
      await createTask("Task 2", { description: "ctx2" });

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

      await runCli(["sync"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain("2 task(s)");
      expect(out).toContain("2 created");
    });

    it("only syncs root tasks, not subtasks", async () => {
      const rootId = await createTask("Root task");
      await createTask("Subtask", { parent: rootId });

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({ number: 301, title: "Root task" }),
      );

      await runCli(["sync"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain("1 task(s)");
    });

    it("reports updated count when updating existing issues", async () => {
      const taskId = await createTask("Already synced");

      // First sync to create the issue
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue(
        "test-owner",
        "test-repo",
        createIssueFixture({ number: 400, title: "Already synced" }),
      );
      await runCli(["sync", taskId], { storage });
      output.stdout.length = 0;

      // Second sync triggers update - listIssues for fetchAllDexIssues cache
      // The body must contain the task ID so the cache can map it
      // Page 1 with data
      githubMock.listIssues("test-owner", "test-repo", [
        createIssueFixture({
          number: 400,
          title: "Old title",
          body: `<!-- dex:task:id:${taskId} -->\nOld body`,
          labels: [{ name: "dex" }],
        }),
      ]);
      // Page 2 empty (end of pagination)
      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.updateIssue(
        "test-owner",
        "test-repo",
        400,
        createIssueFixture({ number: 400, title: "Already synced" }),
      );

      await runCli(["sync"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain("1 task(s)");
      expect(out).toContain("1 updated");
    });
  });

  describe("error handling", () => {
    it("fails when GitHub token is missing", async () => {
      delete process.env.GITHUB_TOKEN;
      await createTask("Task");

      await expect(runCli(["sync"], { storage })).rejects.toThrow(
        "process.exit",
      );
      expect(output.stderr.join("\n")).toMatch(/GitHub token|GITHUB_TOKEN/i);
    });

    it.each([
      [
        "401 unauthorized",
        (mock: GitHubMock) => mock.listIssues401("test-owner", "test-repo"),
      ],
      [
        "403 rate limit",
        (mock: GitHubMock) =>
          mock.listIssues403("test-owner", "test-repo", true),
      ],
      [
        "500 server error",
        (mock: GitHubMock) => {
          mock.listIssues("test-owner", "test-repo", []);
          mock.createIssue500("test-owner", "test-repo");
        },
      ],
    ])("fails on GitHub API %s", async (_, setupMock) => {
      await createTask("Task");
      setupMock(githubMock);

      await expect(runCli(["sync"], { storage })).rejects.toThrow(
        "process.exit",
      );
      expect(output.stderr.join("\n").length).toBeGreaterThan(0);
    });
  });
});
