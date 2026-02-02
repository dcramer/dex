import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli } from "./index.js";
import type { CliTestFixture } from "./test-helpers.js";
import { createCliTestFixture, createTaskAndGetId } from "./test-helpers.js";

describe("complete command", () => {
  let fixture: CliTestFixture;

  beforeEach(() => {
    fixture = createCliTestFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("marks task as completed with result", async () => {
    const taskId = await createTaskAndGetId(fixture, "To complete");

    await runCli(["complete", taskId, "-r", "Done successfully"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Completed");
    expect(out).toContain("Done successfully");
  });

  it("requires --result", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task");

    await expect(
      runCli(["complete", taskId], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("--result");
  });

  it("warns when completing a blocked task but still completes", async () => {
    const blockerId = await createTaskAndGetId(fixture, "Task A");
    const blockedId = await createTaskAndGetId(fixture, "Task B", {
      blockedBy: blockerId,
    });

    await runCli(["complete", blockedId, "-r", "Done anyway"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Warning:");
    expect(out).toContain("blocked by");
    expect(out).toContain("Task A");
    expect(out).toContain("Completed");
  });

  it("fails when completing a task with pending children", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");
    await createTaskAndGetId(fixture, "Child task", { parent: parentId });

    await expect(
      runCli(["complete", parentId, "-r", "Done"], {
        storage: fixture.storage,
      }),
    ).rejects.toThrow("process.exit");

    expect(fixture.output.stderr.join("\n")).toContain("incomplete subtask");
    expect(fixture.output.stderr.join("\n")).toContain("--force");
  });

  it("allows completing task with pending children when --force is used", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");
    await createTaskAndGetId(fixture, "Child task", { parent: parentId });

    await runCli(["complete", parentId, "-r", "Done", "--force"], {
      storage: fixture.storage,
    });

    expect(fixture.output.stdout.join("\n")).toContain("Completed");
  });

  it("fails for nonexistent task", async () => {
    await expect(
      runCli(["complete", "nonexist", "-r", "Done"], {
        storage: fixture.storage,
      }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("not found");
  });

  it("requires task ID", async () => {
    await expect(
      runCli(["complete", "-r", "Done"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("Task ID is required");
  });

  it("persists completion to storage", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task to complete");

    await runCli(["complete", taskId, "-r", "Done with verification"], {
      storage: fixture.storage,
    });

    const tasks = await fixture.storage.readAsync();
    const task = tasks.tasks.find((t) => t.id === taskId);
    expect(task).toBeDefined();
    expect(task?.completed).toBe(true);
    expect(task?.result).toBe("Done with verification");
    expect(task?.completed_at).toBeTruthy();
  });

  it("allows completing parent after all children are completed", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");
    const childId = await createTaskAndGetId(fixture, "Child task", {
      parent: parentId,
    });

    await runCli(["complete", childId, "-r", "Child done"], {
      storage: fixture.storage,
    });
    fixture.output.stdout.length = 0;

    await runCli(["complete", parentId, "-r", "Parent done"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Completed");
  });

  it("shows help with --help flag", async () => {
    await runCli(["complete", "--help"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex complete");
    expect(out).toContain("--result");
    expect(out).toContain("--commit");
  });

  it("accepts commit SHA with -c flag", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task with commit");

    await runCli(["complete", taskId, "-r", "Done", "-c", "abc1234"], {
      storage: fixture.storage,
    });

    const tasks = await fixture.storage.readAsync();
    const task = tasks.tasks.find((t) => t.id === taskId);
    expect(task?.metadata?.commit).toBeDefined();
    expect(task?.metadata?.commit?.sha).toBe("abc1234");
  });

  it("shows --no-commit in help", async () => {
    await runCli(["complete", "--help"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("--no-commit");
  });

  it("accepts --no-commit flag", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task without commit");

    await runCli(["complete", taskId, "-r", "No code changes", "--no-commit"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Completed");

    const tasks = await fixture.storage.readAsync();
    const task = tasks.tasks.find((t) => t.id === taskId);
    expect(task?.completed).toBe(true);
    expect(task?.metadata?.commit).toBeUndefined();
  });

  it("fails when using both --commit and --no-commit", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task");

    await expect(
      runCli(
        ["complete", taskId, "-r", "Done", "-c", "abc123", "--no-commit"],
        { storage: fixture.storage },
      ),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain(
      "Cannot use both --commit and --no-commit",
    );
  });

  it("requires --commit or --no-commit for GitHub-linked leaf task", async () => {
    // Create task with GitHub metadata
    const store = await fixture.storage.readAsync();
    const task = {
      id: "ghlinked",
      parent_id: null,
      name: "GitHub Linked Task",
      description: "Test",
      completed: false,
      priority: 1,
      result: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
      metadata: {
        github: {
          issueNumber: 42,
          issueUrl: "https://github.com/test/repo/issues/42",
          repo: "test/repo",
        },
      },
    };
    store.tasks.push(task);
    await fixture.storage.writeAsync(store);

    await expect(
      runCli(["complete", "ghlinked", "-r", "Done"], {
        storage: fixture.storage,
      }),
    ).rejects.toThrow("process.exit");
    const err = fixture.output.stderr.join("\n");
    expect(err).toContain("GitHub issue #42");
    expect(err).toContain("--commit");
    expect(err).toContain("--no-commit");
  });

  it("allows completion without flags for task without remote link", async () => {
    const taskId = await createTaskAndGetId(fixture, "Local task");

    // Should succeed without --commit or --no-commit
    await runCli(["complete", taskId, "-r", "Done"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Completed");
  });

  it("allows completion without flags for parent task with subtasks", async () => {
    // Create parent with GitHub metadata
    const store = await fixture.storage.readAsync();
    const parent = {
      id: "ghparent",
      parent_id: null,
      name: "GitHub Parent Task",
      description: "Test",
      completed: false,
      priority: 1,
      result: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
      metadata: {
        github: {
          issueNumber: 100,
          issueUrl: "https://github.com/test/repo/issues/100",
          repo: "test/repo",
        },
      },
    };
    const child = {
      id: "ghchild1",
      parent_id: "ghparent",
      name: "Child Task",
      description: "Test",
      completed: true,
      priority: 1,
      result: "Done",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: new Date().toISOString(),
      blockedBy: [],
      blocks: [],
      children: [],
      metadata: null,
    };
    store.tasks.push(parent, child);
    await fixture.storage.writeAsync(store);

    // Parent task has subtasks, so it doesn't require --commit/--no-commit
    await runCli(["complete", "ghparent", "-r", "All subtasks done"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Completed");
  });

  it("fails when multiple positional arguments are provided", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task");

    await expect(
      runCli(["complete", taskId, "extra-arg", "-r", "Done"], {
        storage: fixture.storage,
      }),
    ).rejects.toThrow("process.exit");

    const err = fixture.output.stderr.join("\n");
    expect(err).toContain("unexpected positional argument");
    expect(err).toContain("Use --result to provide completion notes");
  });
});
