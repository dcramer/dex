import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli } from "./index.js";
import type { CliTestFixture } from "./test-helpers.js";
import { createCliTestFixture, createTaskAndGetId } from "./test-helpers.js";

describe("create command", () => {
  let fixture: CliTestFixture;

  beforeEach(() => {
    fixture = createCliTestFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("creates a task with positional name", async () => {
    await runCli(["create", "Test task"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Created");
    expect(out).toContain("Test task");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].name).toBe("Test task");
  });

  it("creates a task with positional name and description", async () => {
    await runCli(["create", "Test task", "--description", "Test description"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Created");
    expect(out).toContain("Test task");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].name).toBe("Test task");
    expect(tasks.tasks[0].description).toBe("Test description");
  });

  it("creates a task with -n flag", async () => {
    await runCli(
      ["create", "-n", "Test task", "--description", "Test description"],
      {
        storage: fixture.storage,
      },
    );

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Created");
    expect(out).toContain("Test task");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].name).toBe("Test task");
  });

  it("shows help with --help flag", async () => {
    await runCli(["create", "--help"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex create");
    expect(out).toContain("--name");
  });

  it("requires name", async () => {
    await expect(
      runCli(["create"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    expect(fixture.output.stderr.join("\n")).toContain("name is required");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(0);
  });

  it("accepts task without context", async () => {
    await runCli(["create", "Task without context"], {
      storage: fixture.storage,
    });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Created");
    expect(out).toContain("Task without context");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].description).toBe("");
  });

  it("creates a task with custom priority", async () => {
    await runCli(["create", "High priority task", "-p", "5"], {
      storage: fixture.storage,
    });

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].priority).toBe(5);
  });

  it("creates a task with parent", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");

    await runCli(["create", "Child task", "--parent", parentId], {
      storage: fixture.storage,
    });

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(2);

    const parent = tasks.tasks.find((t) => t.id === parentId);
    const child = tasks.tasks.find((t) => t.id !== parentId);
    expect(child?.parent_id).toBe(parentId);
    expect(parent?.children).toContain(child?.id);
  });

  it("creates a task with blocker", async () => {
    const blockerId = await createTaskAndGetId(fixture, "Blocker task");

    await runCli(["create", "Blocked task", "--blocked-by", blockerId], {
      storage: fixture.storage,
    });

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(2);

    const blocker = tasks.tasks.find((t) => t.id === blockerId);
    const blocked = tasks.tasks.find((t) => t.id !== blockerId);
    expect(blocked?.blockedBy).toContain(blockerId);
    expect(blocker?.blocks).toContain(blocked?.id);
  });

  it("fails when parent does not exist", async () => {
    await expect(
      runCli(["create", "Orphan task", "--parent", "nonexistent"], {
        storage: fixture.storage,
      }),
    ).rejects.toThrow("process.exit");

    expect(fixture.output.stderr.join("\n")).toContain("not found");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(0);
  });

  it("sets default values correctly", async () => {
    await runCli(["create", "Default task"], { storage: fixture.storage });

    const tasks = await fixture.storage.readAsync();
    const task = tasks.tasks[0];

    expect(task.completed).toBe(false);
    expect(task.priority).toBe(1);
    expect(task.parent_id).toBeNull();
    expect(task.result).toBeNull();
    expect(task.blockedBy).toEqual([]);
    expect(task.blocks).toEqual([]);
    expect(task.children).toEqual([]);
    expect(task.created_at).toBeTruthy();
    expect(task.updated_at).toBeTruthy();
  });

  it("fails when multiple positional arguments are provided", async () => {
    await expect(
      runCli(
        [
          "create",
          "Task name",
          "This looks like a description but is a second positional arg",
        ],
        { storage: fixture.storage },
      ),
    ).rejects.toThrow("process.exit");

    expect(fixture.output.stderr.join("\n")).toContain(
      "unexpected positional argument",
    );

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(0);
  });
});
