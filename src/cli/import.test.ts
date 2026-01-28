import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import type { CapturedOutput, GitHubMock } from "./test-helpers.js";
import {
  captureOutput,
  createTempStorage,
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createFullDexIssueBody,
  createLegacyIssueBody,
  setupShortcutMock,
  cleanupShortcutMock,
  createMemberFixture,
} from "./test-helpers.js";

// Mock git remote detection to return a consistent repo
vi.mock("../core/github/remote.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../core/github/remote.js")>();
  return {
    ...original,
    getGitHubRepo: () => ({ owner: "test-owner", repo: "test-repo" }),
  };
});

// Mock execSync to prevent gh CLI from being used in tests
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes("gh auth token")) {
        throw new Error("gh not authenticated");
      }
      return "";
    }),
  };
});

describe("import command", () => {
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

    // Set up GitHub token
    originalEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";

    // Set up GitHub API mock
    githubMock = setupGitHubMock();
  });

  afterEach(() => {
    output.restore();
    cleanup();
    mockExit.mockRestore();
    cleanupGitHubMock();

    // Restore env
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  describe("help", () => {
    it("shows help with --help flag", async () => {
      await runCli(["import", "--help"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("dex import");
      expect(out).toContain("--update");
      expect(out).toContain("--all");
      expect(out).toContain("--dry-run");
    });
  });

  describe("single issue import", () => {
    it("imports a GitHub issue as a task", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        123,
        createIssueFixture({
          number: 123,
          title: "Test Issue",
          body: "Issue description",
          state: "open",
        }),
      );

      await runCli(["import", "#123"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Imported");
      expect(out).toContain("#123");
      expect(out).toContain("Test Issue");

      // Verify task was created
      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0].name).toBe("Test Issue");
      expect(tasks.tasks[0].metadata?.github?.issueNumber).toBe(123);
    });

    it("imports a closed issue as completed task", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        456,
        createIssueFixture({
          number: 456,
          title: "Closed Issue",
          state: "closed",
        }),
      );

      await runCli(["import", "#456"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks[0].completed).toBe(true);
      expect(tasks.tasks[0].result).toContain("completed");
    });

    it("imports issue with subtasks", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        789,
        createIssueFixture({
          number: 789,
          title: "Parent Issue",
          body: createFullDexIssueBody({
            context: "Main task context",
            subtasks: [
              { id: "sub1", name: "Subtask 1" },
              { id: "sub2", name: "Subtask 2", completed: true },
            ],
          }),
        }),
      );

      await runCli(["import", "#789"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("2 subtask(s)");

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(3); // 1 parent + 2 subtasks
    });

    it("skips already imported issues", async () => {
      // First import
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        111,
        createIssueFixture({
          number: 111,
          title: "Already Imported",
        }),
      );
      await runCli(["import", "#111"], { storage });

      // Second import attempt
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        111,
        createIssueFixture({
          number: 111,
          title: "Already Imported",
        }),
      );
      await runCli(["import", "#111"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Skipped");
      expect(out).toContain("already imported");
      expect(out).toContain("--update");

      // Should still have only 1 task
      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
    });
  });

  describe("--update flag", () => {
    it("updates existing task from GitHub", async () => {
      // First import
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        222,
        createIssueFixture({
          number: 222,
          title: "Original Title",
          body: "Original body",
        }),
      );
      await runCli(["import", "#222"], { storage });

      // Update with changed title
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        222,
        createIssueFixture({
          number: 222,
          title: "Updated Title",
          body: "Updated body",
        }),
      );
      await runCli(["import", "#222", "--update"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Updated");

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0].name).toBe("Updated Title");
    });

    it("updates completion status from GitHub", async () => {
      // Import open issue
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        333,
        createIssueFixture({
          number: 333,
          title: "Open Issue",
          state: "open",
        }),
      );
      await runCli(["import", "#333"], { storage });

      let tasks = await storage.readAsync();
      expect(tasks.tasks[0].completed).toBe(false);

      // Update with closed issue
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        333,
        createIssueFixture({
          number: 333,
          title: "Open Issue",
          state: "closed",
        }),
      );
      await runCli(["import", "#333", "--update"], { storage });

      tasks = await storage.readAsync();
      expect(tasks.tasks[0].completed).toBe(true);
    });
  });

  describe("--dry-run flag", () => {
    it("shows what would be imported without making changes", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        444,
        createIssueFixture({
          number: 444,
          title: "Dry Run Test",
        }),
      );

      await runCli(["import", "#444", "--dry-run"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Would import");
      expect(out).toContain("#444");
      expect(out).toContain("Dry Run Test");

      // No tasks should be created
      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(0);
    });

    it("dry-run with --update shows what would be updated", async () => {
      // First import
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        555,
        createIssueFixture({
          number: 555,
          title: "Original",
        }),
      );
      await runCli(["import", "#555"], { storage });

      // Dry run update
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        555,
        createIssueFixture({
          number: 555,
          title: "Updated",
        }),
      );
      await runCli(["import", "#555", "--update", "--dry-run"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Would update");

      // Task should still have original title
      const tasks = await storage.readAsync();
      expect(tasks.tasks[0].name).toBe("Original");
    });
  });

  describe("--all flag", () => {
    let shortcutMock: ReturnType<typeof setupShortcutMock>;
    let originalShortcutToken: string | undefined;

    beforeEach(() => {
      // Set up Shortcut mock to return empty results
      originalShortcutToken = process.env.SHORTCUT_API_TOKEN;
      process.env.SHORTCUT_API_TOKEN = "test-shortcut-token";
      shortcutMock = setupShortcutMock();
      // Mock getCurrentMember (needed for getWorkspaceSlug)
      shortcutMock.getCurrentMember(createMemberFixture());
      shortcutMock.searchStories([]);
    });

    afterEach(() => {
      cleanupShortcutMock();
      if (originalShortcutToken !== undefined) {
        process.env.SHORTCUT_API_TOKEN = originalShortcutToken;
      } else {
        delete process.env.SHORTCUT_API_TOKEN;
      }
    });

    it("imports all issues with dex label", async () => {
      githubMock.listIssues("test-owner", "test-repo", [
        createIssueFixture({
          number: 1,
          title: "Issue 1",
          labels: [{ name: "dex" }],
        }),
        createIssueFixture({
          number: 2,
          title: "Issue 2",
          labels: [{ name: "dex" }],
        }),
      ]);

      await runCli(["import", "--all"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Imported");
      expect(out).toContain("#1");
      expect(out).toContain("#2");

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(2);
    });

    it("skips pull requests when importing all", async () => {
      githubMock.listIssues("test-owner", "test-repo", [
        createIssueFixture({ number: 1, title: "Issue" }),
        { ...createIssueFixture({ number: 2, title: "PR" }), pull_request: {} },
      ]);

      await runCli(["import", "--all"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0].name).toBe("Issue");
    });
  });

  describe("error handling", () => {
    it("errors without GitHub token", async () => {
      delete process.env.GITHUB_TOKEN;

      await expect(runCli(["import", "#123"], { storage })).rejects.toThrow(
        "process.exit",
      );

      expect(output.stderr.join("\n")).toContain("GitHub token");
    });

    it("errors with invalid issue reference", async () => {
      await expect(runCli(["import", "invalid"], { storage })).rejects.toThrow(
        "process.exit",
      );

      expect(output.stderr.join("\n")).toContain("Invalid issue reference");
    });

    it("requires issue reference or --all", async () => {
      await expect(runCli(["import"], { storage })).rejects.toThrow(
        "process.exit",
      );

      expect(output.stderr.join("\n")).toContain("required");
    });
  });

  describe("round-trip metadata preservation", () => {
    it("preserves root task metadata (id, priority, timestamps)", async () => {
      const timestamp = "2024-01-22T10:00:00.000Z";
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        100,
        createIssueFixture({
          number: 100,
          title: "Task with full metadata",
          body: createFullDexIssueBody({
            context: "Root task context",
            rootMetadata: {
              id: "abc12345",
              priority: 5,
              completed: false,
              created_at: timestamp,
              updated_at: timestamp,
              completed_at: null,
            },
          }),
        }),
      );

      await runCli(["import", "#100"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      const task = tasks.tasks[0];
      expect(task.id).toBe("abc12345");
      expect(task.priority).toBe(5);
      expect(task.completed).toBe(false);
      expect(task.created_at).toBe(timestamp);
      expect(task.updated_at).toBe(timestamp);
      expect(task.completed_at).toBeNull();
    });

    it("preserves root task result field", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        101,
        createIssueFixture({
          number: 101,
          title: "Completed task with result",
          state: "closed",
          body: createFullDexIssueBody({
            context: "Task context",
            rootMetadata: {
              id: "xyz98765",
              completed: true,
              result: "Task completed successfully with all tests passing",
              completed_at: "2024-01-22T12:00:00.000Z",
            },
          }),
        }),
      );

      await runCli(["import", "#101"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.completed).toBe(true);
      expect(task.result).toBe(
        "Task completed successfully with all tests passing",
      );
      expect(task.completed_at).toBe("2024-01-22T12:00:00.000Z");
    });

    it("preserves root task commit metadata", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        102,
        createIssueFixture({
          number: 102,
          title: "Task with commit info",
          body: createFullDexIssueBody({
            context: "Task with commit reference",
            rootMetadata: {
              id: "commit01",
              commit: {
                sha: "abcdef1234567890",
                message: "Fix critical bug",
                branch: "main",
                url: "https://github.com/test-owner/test-repo/commit/abcdef1234567890",
                timestamp: "2024-01-22T11:00:00.000Z",
              },
            },
          }),
        }),
      );

      await runCli(["import", "#102"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.metadata?.commit).toEqual({
        sha: "abcdef1234567890",
        message: "Fix critical bug",
        branch: "main",
        url: "https://github.com/test-owner/test-repo/commit/abcdef1234567890",
        timestamp: "2024-01-22T11:00:00.000Z",
      });
    });

    it("preserves multi-line result using base64 encoding", async () => {
      const multiLineResult =
        "Line 1: Setup complete\nLine 2: Tests passed\nLine 3: Deployed to prod";
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        103,
        createIssueFixture({
          number: 103,
          title: "Task with multi-line result",
          state: "closed",
          body: createFullDexIssueBody({
            context: "Multi-line result test",
            rootMetadata: {
              id: "multiln01",
              completed: true,
              result: multiLineResult,
            },
          }),
        }),
      );

      await runCli(["import", "#103"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.result).toBe(multiLineResult);
    });

    it("preserves commit message with special characters", async () => {
      const commitMessage =
        "feat: Add --> support\n\nMulti-line body with --> arrows";
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        104,
        createIssueFixture({
          number: 104,
          title: "Task with special commit message",
          body: createFullDexIssueBody({
            context: "Special characters test",
            rootMetadata: {
              id: "special1",
              commit: {
                sha: "1234567890abcdef",
                message: commitMessage,
              },
            },
          }),
        }),
      );

      await runCli(["import", "#104"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.metadata?.commit?.message).toBe(commitMessage);
    });
  });

  describe("subtask hierarchy preservation", () => {
    it("preserves subtask parent-child relationships", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        200,
        createIssueFixture({
          number: 200,
          title: "Parent with nested subtasks",
          body: createFullDexIssueBody({
            context: "Hierarchical task",
            rootMetadata: { id: "parent01" },
            subtasks: [
              {
                id: "child001",
                name: "First child",
                description: "Child 1 context",
              },
              {
                id: "child002",
                name: "Second child",
                parentId: "child001",
                description: "Grandchild context",
              },
              {
                id: "child003",
                name: "Third child",
                description: "Child 3 context",
              },
            ],
          }),
        }),
      );

      await runCli(["import", "#200"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(4); // 1 parent + 3 subtasks

      const parent = tasks.tasks.find((t) => t.id === "parent01");
      const child1 = tasks.tasks.find((t) => t.id === "child001");
      const child2 = tasks.tasks.find((t) => t.id === "child002");
      const child3 = tasks.tasks.find((t) => t.id === "child003");

      expect(parent).toBeDefined();
      expect(child1?.parent_id).toBe("parent01");
      expect(child2?.parent_id).toBe("child001"); // Nested under child1
      expect(child3?.parent_id).toBe("parent01");
    });

    it("preserves subtask metadata fields", async () => {
      const timestamp = "2024-01-22T10:00:00.000Z";
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        201,
        createIssueFixture({
          number: 201,
          title: "Parent with metadata-rich subtask",
          body: createFullDexIssueBody({
            context: "Subtask metadata test",
            rootMetadata: { id: "parent02" },
            subtasks: [
              {
                id: "submeta1",
                name: "Subtask with all metadata",
                description: "Full subtask context",
                priority: 3,
                completed: true,
                result: "Subtask completed successfully",
                created_at: timestamp,
                updated_at: "2024-01-22T12:00:00.000Z",
                completed_at: "2024-01-22T12:00:00.000Z",
              },
            ],
          }),
        }),
      );

      await runCli(["import", "#201"], { storage });

      const tasks = await storage.readAsync();
      const subtask = tasks.tasks.find((t) => t.id === "submeta1");

      expect(subtask).toBeDefined();
      expect(subtask?.priority).toBe(3);
      expect(subtask?.completed).toBe(true);
      expect(subtask?.result).toBe("Subtask completed successfully");
      expect(subtask?.created_at).toBe(timestamp);
      expect(subtask?.completed_at).toBe("2024-01-22T12:00:00.000Z");
    });

    it("preserves subtask commit metadata", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        202,
        createIssueFixture({
          number: 202,
          title: "Parent with commit-linked subtask",
          body: createFullDexIssueBody({
            context: "Subtask commit test",
            rootMetadata: { id: "parent03" },
            subtasks: [
              {
                id: "subcomm1",
                name: "Subtask with commit",
                description: "Commit context",
                completed: true,
                commit: {
                  sha: "fedcba0987654321",
                  message: "Implement subtask feature",
                  branch: "feature/subtask",
                  url: "https://github.com/test-owner/test-repo/commit/fedcba0987654321",
                  timestamp: "2024-01-22T11:30:00.000Z",
                },
              },
            ],
          }),
        }),
      );

      await runCli(["import", "#202"], { storage });

      const tasks = await storage.readAsync();
      const subtask = tasks.tasks.find((t) => t.id === "subcomm1");

      expect(subtask?.metadata?.commit).toEqual({
        sha: "fedcba0987654321",
        message: "Implement subtask feature",
        branch: "feature/subtask",
        url: "https://github.com/test-owner/test-repo/commit/fedcba0987654321",
        timestamp: "2024-01-22T11:30:00.000Z",
      });
    });

    it("preserves subtask order", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        203,
        createIssueFixture({
          number: 203,
          title: "Parent with ordered subtasks",
          body: createFullDexIssueBody({
            context: "Ordered subtasks test",
            rootMetadata: { id: "parent04" },
            subtasks: [
              { id: "order001", name: "First", priority: 1 },
              { id: "order002", name: "Second", priority: 2 },
              { id: "order003", name: "Third", priority: 3 },
            ],
          }),
        }),
      );

      await runCli(["import", "#203"], { storage });

      const tasks = await storage.readAsync();
      const subtasks = tasks.tasks
        .filter((t) => t.id.startsWith("order"))
        .sort((a, b) => a.priority - b.priority);

      expect(subtasks.map((s) => s.id)).toEqual([
        "order001",
        "order002",
        "order003",
      ]);
      expect(subtasks.map((s) => s.name)).toEqual(["First", "Second", "Third"]);
    });
  });

  describe("backwards compatibility", () => {
    it("imports issue with legacy format (just task ID)", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        300,
        createIssueFixture({
          number: 300,
          title: "Legacy format issue",
          body: createLegacyIssueBody({
            context: "Old sync format context",
            taskId: "legacy01",
          }),
        }),
      );

      await runCli(["import", "#300"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      const task = tasks.tasks[0];
      expect(task.id).toBe("legacy01");
      expect(task.description).toBe("Old sync format context");
    });

    it("imports issue without any dex metadata (manually created)", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        301,
        createIssueFixture({
          number: 301,
          title: "Manually created issue",
          body: "This is a manually created GitHub issue.\n\nNo dex metadata here.",
        }),
      );

      await runCli(["import", "#301"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      const task = tasks.tasks[0];
      // Should get a generated ID
      expect(task.id).toMatch(/^[a-z0-9]{8}$/);
      expect(task.name).toBe("Manually created issue");
      expect(task.description).toBe(
        "This is a manually created GitHub issue.\n\nNo dex metadata here.",
      );
    });

    it("imports issue with old subtask format (## Subtasks)", async () => {
      const oldFormatBody = `Task context here.

## Subtasks

<details>
<summary>[ ] Old format subtask</summary>
<!-- dex:subtask:id:oldsub01 -->
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->

### Context
Old subtask context.

</details>`;

      githubMock.getIssue(
        "test-owner",
        "test-repo",
        302,
        createIssueFixture({
          number: 302,
          title: "Old subtask format",
          body: oldFormatBody,
        }),
      );

      await runCli(["import", "#302"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(2); // 1 parent + 1 subtask
      const subtask = tasks.tasks.find((t) => t.id === "oldsub01");
      expect(subtask).toBeDefined();
      expect(subtask?.completed).toBe(false);
    });

    it("falls back to issue state when no completion metadata", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        303,
        createIssueFixture({
          number: 303,
          title: "Closed without metadata",
          state: "closed",
          body: "Simple closed issue without dex metadata.",
        }),
      );

      await runCli(["import", "#303"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.completed).toBe(true);
      expect(task.result).toContain("completed");
    });
  });

  describe("edge cases", () => {
    it("handles empty context gracefully", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        400,
        createIssueFixture({
          number: 400,
          title: "Issue with empty body",
          body: "",
        }),
      );

      await runCli(["import", "#400"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.description).toContain("Imported from GitHub issue");
    });

    it("handles null body gracefully", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        401,
        createIssueFixture({
          number: 401,
          title: "Issue with null body",
          body: null,
        }),
      );

      await runCli(["import", "#401"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
    });

    it("handles special characters in description", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        402,
        createIssueFixture({
          number: 402,
          title: "Fix <script>alert('XSS')</script> & other \"special\" chars",
          body: "Context with <html> & \"quotes\" and 'apostrophes'",
        }),
      );

      await runCli(["import", "#402"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.name).toContain("<script>");
      expect(task.description).toContain("<html>");
    });

    it("handles very long context without truncation", async () => {
      const longContext = "A".repeat(10000);
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        403,
        createIssueFixture({
          number: 403,
          title: "Long context issue",
          body: longContext,
        }),
      );

      await runCli(["import", "#403"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.description.length).toBe(10000);
    });

    it("strips root task metadata comments from context", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        404,
        createIssueFixture({
          number: 404,
          title: "Clean context test",
          body: createFullDexIssueBody({
            context: "Actual task context without metadata comments",
            rootMetadata: {
              id: "clean001",
              priority: 1,
              completed: false,
            },
          }),
        }),
      );

      await runCli(["import", "#404"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      // Context should not contain dex:task: comments
      expect(task.description).not.toContain("<!-- dex:task:");
      expect(task.description).toBe(
        "Actual task context without metadata comments",
      );
    });

    it("preserves GitHub metadata correctly", async () => {
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        405,
        createIssueFixture({
          number: 405,
          title: "GitHub metadata test",
          body: "Simple body",
        }),
      );

      await runCli(["import", "#405"], { storage });

      const tasks = await storage.readAsync();
      const task = tasks.tasks[0];
      expect(task.metadata?.github).toEqual({
        issueNumber: 405,
        issueUrl: "https://github.com/test-owner/test-repo/issues/405",
        repo: "test-owner/test-repo",
      });
    });
  });

  describe("ID conflict handling", () => {
    it("fails when importing issue with conflicting task ID", async () => {
      // First import
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        500,
        createIssueFixture({
          number: 500,
          title: "First task",
          body: createFullDexIssueBody({
            context: "First context",
            rootMetadata: { id: "conflict1" },
          }),
        }),
      );
      await runCli(["import", "#500"], { storage });

      // Second import with same ID but different issue
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        501,
        createIssueFixture({
          number: 501,
          title: "Second task with same ID",
          body: createFullDexIssueBody({
            context: "Second context",
            rootMetadata: { id: "conflict1" },
          }),
        }),
      );

      await expect(runCli(["import", "#501"], { storage })).rejects.toThrow(
        "process.exit",
      );

      // Should still have only 1 task
      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
    });

    it("--update works for re-importing same issue with same ID", async () => {
      // First import
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        502,
        createIssueFixture({
          number: 502,
          title: "Original title",
          body: createFullDexIssueBody({
            context: "Original context",
            rootMetadata: { id: "update001" },
          }),
        }),
      );
      await runCli(["import", "#502"], { storage });

      // Update same issue
      githubMock.getIssue(
        "test-owner",
        "test-repo",
        502,
        createIssueFixture({
          number: 502,
          title: "Updated title",
          body: createFullDexIssueBody({
            context: "Updated context",
            rootMetadata: { id: "update001", priority: 5 },
          }),
        }),
      );
      await runCli(["import", "#502", "--update"], { storage });

      const tasks = await storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      const task = tasks.tasks[0];
      expect(task.name).toBe("Updated title");
      expect(task.priority).toBe(5);
    });
  });
});
