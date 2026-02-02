import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import { runCli } from "./index.js";
import type { CliTestFixture } from "./test-helpers.js";
import { createCliTestFixture, createTaskAndGetId } from "./test-helpers.js";
import { ArchiveStorage } from "../core/storage/archive-storage.js";

describe("archive command", () => {
  let fixture: CliTestFixture;

  beforeEach(() => {
    fixture = createCliTestFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("shows help with --help flag", async () => {
    await runCli(["archive", "--help"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex archive");
    expect(out).toContain("Archive completed tasks");
    expect(out).toContain("REQUIREMENTS");
  });

  it("requires task ID", async () => {
    await expect(
      runCli(["archive"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("Task ID is required");
  });

  it("fails for nonexistent task", async () => {
    await expect(
      runCli(["archive", "nonexist"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("not found");
  });

  it("fails for pending task", async () => {
    const taskId = await createTaskAndGetId(fixture, "Pending task");

    await expect(
      runCli(["archive", taskId], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const stderr = fixture.output.stderr.join("\n");
    expect(stderr).toContain("not completed");
    expect(stderr).toContain("dex complete");
  });

  it("archives a completed task", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task to archive");
    await runCli(["complete", taskId, "--result", "Done"], {
      storage: fixture.storage,
    });
    fixture.output.stdout.length = 0;

    await runCli(["archive", taskId], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Archived");
    expect(out).toContain("1");
    expect(out).toContain("Size reduction");

    // Verify task removed from active store
    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(0);

    // Verify task added to archive
    const archiveStorage = new ArchiveStorage({
      path: fixture.storage.getIdentifier(),
    });
    const archive = archiveStorage.readArchive();
    expect(archive.tasks).toHaveLength(1);
    expect(archive.tasks[0].id).toBe(taskId);
  });

  it("archives task with completed subtasks", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");
    const child1Id = await createTaskAndGetId(fixture, "Child 1", {
      parent: parentId,
    });
    const child2Id = await createTaskAndGetId(fixture, "Child 2", {
      parent: parentId,
    });

    // Complete all tasks
    await runCli(["complete", child1Id, "--result", "Done"], {
      storage: fixture.storage,
    });
    await runCli(["complete", child2Id, "--result", "Done"], {
      storage: fixture.storage,
    });
    await runCli(["complete", parentId, "--result", "All done"], {
      storage: fixture.storage,
    });
    fixture.output.stdout.length = 0;

    await runCli(["archive", parentId], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Archived");
    expect(out).toContain("3");
    expect(out).toContain("Subtasks: 2");

    // Verify all tasks removed from active store
    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(0);

    // Verify all tasks added to archive
    const archiveStorage = new ArchiveStorage({
      path: fixture.storage.getIdentifier(),
    });
    const archive = archiveStorage.readArchive();
    expect(archive.tasks).toHaveLength(3);
  });

  it("fails when subtask is not completed", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");
    await createTaskAndGetId(fixture, "Incomplete child", { parent: parentId });

    // Mark parent as completed directly in storage (bypassing validation)
    const store = await fixture.storage.readAsync();
    const parent = store.tasks.find((t) => t.id === parentId);
    if (parent) {
      parent.completed = true;
      parent.completed_at = new Date().toISOString();
      parent.result = "Done";
    }
    await fixture.storage.writeAsync(store);
    fixture.output.stderr.length = 0;

    await expect(
      runCli(["archive", parentId], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const stderr = fixture.output.stderr.join("\n");
    expect(stderr).toContain("incomplete");
    expect(stderr).toContain("subtask");
  });

  it("fails when ancestor is not completed", async () => {
    const parentId = await createTaskAndGetId(fixture, "Parent task");
    const childId = await createTaskAndGetId(fixture, "Child task", {
      parent: parentId,
    });

    // Complete only the child
    await runCli(["complete", childId, "--result", "Done"], {
      storage: fixture.storage,
    });
    fixture.output.stderr.length = 0;

    await expect(
      runCli(["archive", childId], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const stderr = fixture.output.stderr.join("\n");
    expect(stderr).toContain("incomplete");
    expect(stderr).toContain("ancestor");
  });

  it("cleans up blocking references when archiving", async () => {
    const blockerId = await createTaskAndGetId(fixture, "Blocker task");
    const blockedId = await createTaskAndGetId(fixture, "Blocked task", {
      blockedBy: blockerId,
    });

    // Complete the blocker
    await runCli(["complete", blockerId, "--result", "Done"], {
      storage: fixture.storage,
    });
    fixture.output.stdout.length = 0;

    // Archive the blocker
    await runCli(["archive", blockerId], { storage: fixture.storage });

    // Verify blocked task's blockedBy is cleaned up
    const tasks = await fixture.storage.readAsync();
    const blocked = tasks.tasks.find((t) => t.id === blockedId);
    expect(blocked?.blockedBy).toEqual([]);
  });

  it("preserves sibling tasks when archiving", async () => {
    const task1Id = await createTaskAndGetId(fixture, "Task 1");
    const task2Id = await createTaskAndGetId(fixture, "Task 2");

    // Complete and archive task1
    await runCli(["complete", task1Id, "--result", "Done"], {
      storage: fixture.storage,
    });
    await runCli(["archive", task1Id], { storage: fixture.storage });

    // Verify task2 still exists
    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].id).toBe(task2Id);
  });

  it("preserves description when archiving", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task with description", {
      description: "This is a description that should be preserved",
    });
    await runCli(["complete", taskId, "--result", "Done"], {
      storage: fixture.storage,
    });
    await runCli(["archive", taskId], { storage: fixture.storage });

    // Verify archived task has description preserved
    const archiveStorage = new ArchiveStorage({
      path: fixture.storage.getIdentifier(),
    });
    const archive = archiveStorage.readArchive();
    expect(archive.tasks[0].description).toBe(
      "This is a description that should be preserved",
    );
    expect(archive.tasks[0].result).toBe("Done");
  });

  it("fails when multiple positional arguments are provided", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task");

    await expect(
      runCli(["archive", taskId, "extra-arg"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    expect(fixture.output.stderr.join("\n")).toContain(
      "unexpected positional argument",
    );
  });
});
