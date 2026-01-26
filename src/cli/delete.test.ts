import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli } from "./index.js";
import {
  createCliTestFixture,
  createTaskAndGetId,
  CliTestFixture,
} from "./test-helpers.js";

describe("delete command", () => {
  let fixture: CliTestFixture;

  beforeEach(() => {
    fixture = createCliTestFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("deletes a task with force flag", async () => {
    const taskId = await createTaskAndGetId(fixture, "To delete");

    await runCli(["delete", taskId, "-f"], { storage: fixture.storage });
    expect(fixture.output.stdout.join("\n")).toContain("Deleted");

    const tasks = await fixture.storage.readAsync();
    expect(tasks.tasks).toHaveLength(0);
  });

  it("fails for nonexistent task", async () => {
    await expect(
      runCli(["delete", "nonexist", "-f"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("not found");
  });

  it("requires task ID", async () => {
    await expect(
      runCli(["delete", "-f"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");
    expect(fixture.output.stderr.join("\n")).toContain("Task ID is required");
  });

  it("shows help with --help flag", async () => {
    await runCli(["delete", "--help"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex delete");
    expect(out).toContain("--force");
  });

  describe("cascade deletion", () => {
    it("deletes task and all its children", async () => {
      const parentId = await createTaskAndGetId(fixture, "Parent task");
      await createTaskAndGetId(fixture, "Child 1", { parent: parentId });
      await createTaskAndGetId(fixture, "Child 2", { parent: parentId });

      await runCli(["delete", parentId, "-f"], { storage: fixture.storage });

      const tasks = await fixture.storage.readAsync();
      expect(tasks.tasks).toHaveLength(0);
    });

    it("deletes nested descendants (grandchildren)", async () => {
      const grandparentId = await createTaskAndGetId(fixture, "Grandparent");
      const parentId = await createTaskAndGetId(fixture, "Parent", {
        parent: grandparentId,
      });
      await createTaskAndGetId(fixture, "Child", { parent: parentId });

      await runCli(["delete", grandparentId, "-f"], {
        storage: fixture.storage,
      });

      const tasks = await fixture.storage.readAsync();
      expect(tasks.tasks).toHaveLength(0);
    });

    it("only deletes descendants, not siblings", async () => {
      const parentId = await createTaskAndGetId(fixture, "Parent");
      const child1Id = await createTaskAndGetId(fixture, "Child 1", {
        parent: parentId,
      });
      await createTaskAndGetId(fixture, "Child 2", { parent: parentId });

      await runCli(["delete", child1Id, "-f"], { storage: fixture.storage });

      const tasks = await fixture.storage.readAsync();
      expect(tasks.tasks).toHaveLength(2);
      expect(tasks.tasks.find((t) => t.name === "Parent")).toBeDefined();
      expect(tasks.tasks.find((t) => t.name === "Child 2")).toBeDefined();
    });
  });

  describe("blocking relationship cleanup", () => {
    it("removes deleted task from blockedBy arrays of other tasks", async () => {
      const blockerId = await createTaskAndGetId(fixture, "Blocker");
      await createTaskAndGetId(fixture, "Blocked task", {
        blockedBy: blockerId,
      });

      await runCli(["delete", blockerId, "-f"], { storage: fixture.storage });

      const tasks = await fixture.storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0].blockedBy).not.toContain(blockerId);
      expect(tasks.tasks[0].blockedBy).toEqual([]);
    });

    it("removes deleted task from blocks arrays of other tasks", async () => {
      const blockerId = await createTaskAndGetId(fixture, "Blocker");
      const blockedId = await createTaskAndGetId(fixture, "Blocked task", {
        blockedBy: blockerId,
      });

      await runCli(["delete", blockedId, "-f"], { storage: fixture.storage });

      const tasks = await fixture.storage.readAsync();
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0].id).toBe(blockerId);
      expect(tasks.tasks[0].blocks).not.toContain(blockedId);
      expect(tasks.tasks[0].blocks).toEqual([]);
    });

    it("removes deleted task from children arrays of parent tasks", async () => {
      const parentId = await createTaskAndGetId(fixture, "Parent");
      const childId = await createTaskAndGetId(fixture, "Child", {
        parent: parentId,
      });

      // Verify parent has child in children array initially
      let tasks = await fixture.storage.readAsync();
      const parentBefore = tasks.tasks.find((t) => t.id === parentId);
      expect(parentBefore?.children).toContain(childId);

      // Create a three-level hierarchy then delete the middle
      const grandparentId = await createTaskAndGetId(fixture, "Grandparent");
      const middleId = await createTaskAndGetId(fixture, "Middle", {
        parent: grandparentId,
      });

      await runCli(["delete", middleId, "-f"], { storage: fixture.storage });

      tasks = await fixture.storage.readAsync();
      const grandparent = tasks.tasks.find((t) => t.id === grandparentId);
      expect(grandparent?.children).not.toContain(middleId);
    });
  });

  it("returns the deleted task info in output", async () => {
    const taskId = await createTaskAndGetId(fixture, "Task to delete");

    await runCli(["delete", taskId, "-f"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Deleted");
    expect(out).toContain(taskId);
  });
});
