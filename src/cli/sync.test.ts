import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCli } from "./index.js";
import type {
  CliTestFixture,
  GitHubMock,
  ShortcutMock,
} from "./test-helpers.js";
import {
  createCliTestFixture,
  createTaskAndGetId,
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  setupShortcutMock,
  cleanupShortcutMock,
  createStoryFixture,
  createWorkflowFixture,
  createTeamFixture,
  createMemberFixture,
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

describe("sync command", () => {
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
    vi.restoreAllMocks();
  });

  function createTask(
    name: string,
    opts: { description?: string; parent?: string } = {},
  ): Promise<string> {
    return createTaskAndGetId(fixture, name, {
      description: opts.description ?? "ctx",
      parent: opts.parent,
    });
  }

  function run(args: string[]): Promise<void> {
    return runCli(args, { storage: fixture.storage, syncRegistry });
  }

  it.each([["--help"], ["-h"]])("shows help with %s flag", async (flag) => {
    await run(["sync", flag]);
    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex sync");
    expect(out).toContain("Push tasks to GitHub Issues");
  });

  it("reports no tasks to sync when empty", async () => {
    await run(["sync"]);
    expect(fixture.output.stdout.join("\n")).toContain("No tasks to sync");
  });

  describe("dry-run mode", () => {
    it("previews sync without making changes for all tasks", async () => {
      const taskId = await createTask("Test task", { description: "context" });

      await run(["sync", "--dry-run"]);

      const out = fixture.output.stdout.join("\n");
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
      await run(["sync", taskId]);
      fixture.output.stdout.length = 0;

      // Dry-run should show update
      await run(["sync", "--dry-run"]);

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Would sync");
      expect(out).toContain("[update]");
    });

    it("previews sync for specific task", async () => {
      const taskId = await createTask("Task to sync");

      await run(["sync", taskId, "--dry-run"]);

      const out = fixture.output.stdout.join("\n");
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

      await run(["sync", taskId]);

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain(taskId);
      expect(out).toContain("test-owner/test-repo");
      expect(out).toContain("issues/101");
    });

    it("fails when task not found", async () => {
      await expect(run(["sync", "nonexist"])).rejects.toThrow("process.exit");
      expect(fixture.output.stderr.join("\n")).toContain("not found");
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

      await run(["sync", subtaskId]);

      const out = fixture.output.stdout.join("\n");
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

      await run(["sync"]);

      const out = fixture.output.stdout.join("\n");
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

      await run(["sync"]);

      const out = fixture.output.stdout.join("\n");
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
      await run(["sync", taskId]);
      fixture.output.stdout.length = 0;

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

      await run(["sync"]);

      const out = fixture.output.stdout.join("\n");
      expect(out).toContain("Synced");
      expect(out).toContain("1 task(s)");
      expect(out).toContain("1 updated");
    });
  });

  describe("error handling", () => {
    it("fails when GitHub token is missing", async () => {
      delete process.env.GITHUB_TOKEN;
      // Also ensure no Shortcut token so no sync service is available
      const originalShortcutToken = process.env.SHORTCUT_API_TOKEN;
      delete process.env.SHORTCUT_API_TOKEN;

      await createTask("Task");

      try {
        await expect(
          runCli(["sync"], { storage: fixture.storage }),
        ).rejects.toThrow("process.exit");
        // When no sync services are available, shows generic error
        expect(fixture.output.stderr.join("\n")).toMatch(
          /No sync services available|GitHub token|GITHUB_TOKEN/i,
        );
      } finally {
        // Restore Shortcut token
        if (originalShortcutToken !== undefined) {
          process.env.SHORTCUT_API_TOKEN = originalShortcutToken;
        }
      }
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

      await expect(run(["sync"])).rejects.toThrow("process.exit");
      expect(fixture.output.stderr.join("\n").length).toBeGreaterThan(0);
    });
  });
});

describe("sync command --shortcut", () => {
  let fixture: CliTestFixture;
  let shortcutMock: ShortcutMock;
  let originalEnv: string | undefined;
  let originalGithubEnv: string | undefined;
  let syncRegistry: SyncRegistry;

  beforeEach(() => {
    fixture = createCliTestFixture();

    // Set Shortcut token, remove GitHub token to test Shortcut-only
    originalEnv = process.env.SHORTCUT_API_TOKEN;
    originalGithubEnv = process.env.GITHUB_TOKEN;
    process.env.SHORTCUT_API_TOKEN = "test-shortcut-token";
    delete process.env.GITHUB_TOKEN;

    shortcutMock = setupShortcutMock();
    // Create registry with Shortcut service (but not GitHub)
    syncRegistry = createTestSyncRegistry({ shortcut: {} });
  });

  afterEach(() => {
    fixture.cleanup();
    cleanupShortcutMock();
    if (originalEnv !== undefined) {
      process.env.SHORTCUT_API_TOKEN = originalEnv;
    } else {
      delete process.env.SHORTCUT_API_TOKEN;
    }
    if (originalGithubEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalGithubEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.restoreAllMocks();
  });

  function createTask(
    name: string,
    opts: { description?: string; parent?: string } = {},
  ): Promise<string> {
    return createTaskAndGetId(fixture, name, {
      description: opts.description ?? "ctx",
      parent: opts.parent,
    });
  }

  function run(args: string[]): Promise<void> {
    return runCli(args, { storage: fixture.storage, syncRegistry });
  }

  /** Setup common Shortcut mocks for sync operations */
  function setupShortcutSyncMocks() {
    shortcutMock.getCurrentMember(createMemberFixture());
    shortcutMock.listGroups([createTeamFixture()]);
    shortcutMock.getGroup("test-team-uuid", createTeamFixture());
    shortcutMock.getWorkflow(
      500000000,
      createWorkflowFixture({ id: 500000000 }),
    );
    shortcutMock.listLabels([{ id: 1, name: "dex" }]);
  }

  it("fails when Shortcut token is missing", async () => {
    // Use empty registry so Shortcut service is not available
    const emptyRegistry = createTestSyncRegistry({});
    await createTask("Task");

    await expect(
      runCli(["sync", "--shortcut"], {
        storage: fixture.storage,
        syncRegistry: emptyRegistry,
      }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toMatch(
      /Shortcut sync not available|SHORTCUT_API_TOKEN/i,
    );
  });

  it("fails when team is not configured", async () => {
    // Use empty registry so Shortcut service is not available
    const emptyRegistry = createTestSyncRegistry({});
    await createTask("Task");
    shortcutMock.getCurrentMember(createMemberFixture());

    await expect(
      runCli(["sync", "--shortcut"], {
        storage: fixture.storage,
        syncRegistry: emptyRegistry,
      }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toMatch(
      /Shortcut sync not available/i,
    );
  });

  describe("with team configured", () => {
    describe("dry-run mode", () => {
      it("previews sync without making changes", async () => {
        const taskId = await createTask("Test task", {
          description: "context",
        });
        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);

        await run(["sync", "--shortcut", "--dry-run"]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Would sync");
        expect(out).toContain("test-workspace");
        expect(out).toContain("[create]");
        expect(out).toContain(taskId);
      });

      it("shows update action for tasks already synced", async () => {
        const taskId = await createTask("Synced task", {
          description: "context",
        });

        // First sync to create Shortcut metadata
        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        shortcutMock.createStory(
          createStoryFixture({
            id: 123,
            name: "Synced task",
          }),
        );
        await run(["sync", "--shortcut", taskId]);
        fixture.output.stdout.length = 0;

        // Set up fresh mocks for the dry-run (nock interceptors are consumed after one use)
        setupShortcutSyncMocks();
        shortcutMock.searchStories([
          createStoryFixture({
            id: 123,
            name: "Old title",
            description: `<!-- dex:task:id:${taskId} -->\nOld body`,
            labels: [{ name: "dex" }],
          }),
        ]);

        await run(["sync", "--shortcut", "--dry-run"]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Would sync");
        expect(out).toContain("[update]");
      });

      it("previews sync for specific task", async () => {
        const taskId = await createTask("Task to sync");
        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);

        await run(["sync", "--shortcut", taskId, "--dry-run"]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Would sync");
        expect(out).toContain(taskId);
      });
    });

    describe("sync specific task", () => {
      it("syncs a specific task to Shortcut", async () => {
        const taskId = await createTask("Task to sync", {
          description: "Some context",
        });

        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        shortcutMock.createStory(
          createStoryFixture({
            id: 101,
            name: "Task to sync",
          }),
        );

        await run(["sync", "--shortcut", taskId]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Synced");
        expect(out).toContain(taskId);
        expect(out).toContain("test-workspace");
        expect(out).toContain("story/101");
      });

      it("fails when task not found", async () => {
        setupShortcutSyncMocks();

        await expect(run(["sync", "--shortcut", "nonexist"])).rejects.toThrow(
          "process.exit",
        );
        expect(fixture.output.stderr.join("\n")).toContain("not found");
      });

      it("syncs subtask by finding root task", async () => {
        const parentId = await createTask("Parent task");
        const subtaskId = await createTask("Subtask", { parent: parentId });

        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        // Parent story created
        shortcutMock.createStory(
          createStoryFixture({ id: 102, name: "Parent task" }),
        );
        // Subtask as Shortcut Sub-task
        shortcutMock.createStory(
          createStoryFixture({ id: 103, name: "Subtask" }),
        );

        // Sync the subtask - should sync the parent instead
        await run(["sync", "--shortcut", subtaskId]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Synced");
        expect(out).toContain(parentId);
      });

      it("saves shortcut metadata after sync", async () => {
        const taskId = await createTask("Task to sync", {
          description: "Some context",
        });

        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        shortcutMock.createStory(
          createStoryFixture({
            id: 999,
            name: "Task to sync",
          }),
        );

        await run(["sync", "--shortcut", taskId]);

        // Clear output from sync command before getting JSON
        fixture.output.stdout.length = 0;

        // Verify metadata was saved by checking the task
        await run(["show", taskId, "--json"]);
        const showOutput = fixture.output.stdout.join("\n");
        const task = JSON.parse(showOutput);
        expect(task.metadata?.shortcut).toBeDefined();
        expect(task.metadata.shortcut.storyId).toBe(999);
        expect(task.metadata.shortcut.workspace).toBe("test-workspace");
        expect(task.metadata.shortcut.storyUrl).toContain("story/999");
      });
    });

    describe("sync all tasks", () => {
      it("syncs all root tasks to Shortcut", async () => {
        await createTask("Task 1", { description: "ctx1" });
        await createTask("Task 2", { description: "ctx2" });

        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        shortcutMock.createStory(
          createStoryFixture({ id: 201, name: "Task 1" }),
        );
        shortcutMock.createStory(
          createStoryFixture({ id: 202, name: "Task 2" }),
        );

        await run(["sync", "--shortcut"]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Synced");
        expect(out).toContain("2 task(s)");
        expect(out).toContain("2 created");
      });

      it("counts only root tasks in sync summary (subtasks synced as Shortcut Sub-tasks)", async () => {
        const rootId = await createTask("Root task");
        await createTask("Subtask", { parent: rootId });

        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        // Root task creates a story
        shortcutMock.createStory(
          createStoryFixture({ id: 301, name: "Root task" }),
        );
        // Subtask creates a Shortcut Sub-task (linked to parent story 301)
        shortcutMock.createStory(
          createStoryFixture({ id: 302, name: "Subtask" }),
        );

        await run(["sync", "--shortcut"]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Synced");
        // Only root tasks are counted, but subtasks are still synced as Shortcut Sub-tasks
        expect(out).toContain("1 task(s)");
      });

      it("reports updated count when updating existing stories", async () => {
        const taskId = await createTask("Already synced");

        // First sync to create the story
        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        shortcutMock.createStory(
          createStoryFixture({ id: 400, name: "Already synced" }),
        );
        await run(["sync", "--shortcut", taskId]);
        fixture.output.stdout.length = 0;

        // Second sync triggers update - searchStories returns existing story
        setupShortcutSyncMocks();
        shortcutMock.searchStories([
          createStoryFixture({
            id: 400,
            name: "Old title",
            description: `<!-- dex:task:id:${taskId} -->\nOld body`,
            labels: [{ name: "dex" }],
          }),
        ]);
        shortcutMock.updateStory(
          400,
          createStoryFixture({ id: 400, name: "Already synced" }),
        );

        await run(["sync", "--shortcut"]);

        const out = fixture.output.stdout.join("\n");
        expect(out).toContain("Synced");
        expect(out).toContain("1 task(s)");
        expect(out).toContain("1 updated");
      });

      it("saves subtask metadata after sync", async () => {
        const parentId = await createTask("Parent task");
        const subtaskId = await createTask("Subtask", { parent: parentId });

        setupShortcutSyncMocks();
        shortcutMock.searchStories([]);
        // Parent story
        shortcutMock.createStory(
          createStoryFixture({ id: 500, name: "Parent task" }),
        );
        // Subtask story
        shortcutMock.createStory(
          createStoryFixture({ id: 501, name: "Subtask" }),
        );

        await run(["sync", "--shortcut"]);
        fixture.output.stdout.length = 0;

        // Verify subtask metadata was saved
        await run(["show", subtaskId, "--json"]);
        const showOutput = fixture.output.stdout.join("\n");
        const task = JSON.parse(showOutput);
        expect(task.metadata?.shortcut).toBeDefined();
        expect(task.metadata.shortcut.storyId).toBe(501);
        expect(task.metadata.shortcut.workspace).toBe("test-workspace");
      });
    });

    describe("error handling", () => {
      it.each([
        [
          "401 unauthorized",
          (mock: ShortcutMock) => {
            mock.getCurrentMember(createMemberFixture());
            mock.listGroups([createTeamFixture()]);
            mock.getGroup("test-team-uuid", createTeamFixture());
            mock.getWorkflow(
              500000000,
              createWorkflowFixture({ id: 500000000 }),
            );
            mock.listLabels([{ id: 1, name: "dex" }]);
            mock.searchStories401();
          },
        ],
        [
          "500 server error on create",
          (mock: ShortcutMock) => {
            mock.getCurrentMember(createMemberFixture());
            mock.listGroups([createTeamFixture()]);
            mock.getGroup("test-team-uuid", createTeamFixture());
            mock.getWorkflow(
              500000000,
              createWorkflowFixture({ id: 500000000 }),
            );
            mock.listLabels([{ id: 1, name: "dex" }]);
            mock.searchStories([]);
            mock.createStory500();
          },
        ],
      ])("fails on Shortcut API %s", async (_, setupMock) => {
        await createTask("Task");
        setupMock(shortcutMock);

        await expect(run(["sync", "--shortcut"])).rejects.toThrow(
          "process.exit",
        );
        expect(fixture.output.stderr.join("\n").length).toBeGreaterThan(0);
      });
    });
  });
});
