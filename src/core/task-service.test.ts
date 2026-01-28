import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TaskService } from "./task-service.js";
import { GitHubSyncService } from "./github/index.js";
import { ValidationError } from "../errors.js";

describe("TaskService", () => {
  let tempDir: string;
  let storagePath: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-test-"));
    storagePath = path.join(tempDir, ".dex");
    service = new TaskService(storagePath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a task with required fields", async () => {
      const task = await service.create({
        name: "Test task",
        description: "Test description",
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe("Test task");
      expect(task.description).toBe("Test description");
      expect(task.completed).toBe(false);
      expect(task.priority).toBe(1);
      expect(task.parent_id).toBeNull();
      expect(task.result).toBeNull();
    });

    it("creates a task with custom priority", async () => {
      const task = await service.create({
        name: "Test task",
        description: "Test description",
        priority: 5,
      });

      expect(task.priority).toBe(5);
    });

    it("creates a child task with parent_id", async () => {
      const parent = await service.create({
        name: "Parent task",
        description: "Parent description",
      });

      const child = await service.create({
        name: "Child task",
        description: "Child description",
        parent_id: parent.id,
      });

      expect(child.parent_id).toBe(parent.id);
    });

    it("throws when parent task does not exist", async () => {
      await expect(
        service.create({
          name: "Orphan task",
          description: "Description",
          parent_id: "nonexistent",
        }),
      ).rejects.toThrow('Task "nonexistent" not found');
    });
  });

  describe("get", () => {
    it("returns task by id", async () => {
      const created = await service.create({
        name: "Test",
        description: "Description",
      });

      const retrieved = await service.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it("returns null for nonexistent task", async () => {
      const result = await service.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("updates task name", async () => {
      const task = await service.create({
        name: "Original",
        description: "Description",
      });

      const updated = await service.update({
        id: task.id,
        name: "Updated",
      });

      expect(updated.name).toBe("Updated");
      expect(updated.description).toBe("Description");
    });

    it("updates multiple fields", async () => {
      const task = await service.create({
        name: "Test",
        description: "Description",
      });

      const updated = await service.update({
        id: task.id,
        name: "New name",
        description: "New description",
        priority: 10,
      });

      expect(updated.name).toBe("New name");
      expect(updated.description).toBe("New description");
      expect(updated.priority).toBe(10);
    });

    it("throws when task does not exist", async () => {
      await expect(
        service.update({
          id: "nonexistent",
          name: "Updated",
        }),
      ).rejects.toThrow('Task "nonexistent" not found');
    });

    it("deletes task via update with delete flag", async () => {
      const task = await service.create({
        name: "To delete",
        description: "Context",
      });

      const deleted = await service.update({
        id: task.id,
        delete: true,
      });

      expect(deleted.id).toBe(task.id);
      expect(await service.get(task.id)).toBeNull();
    });

    it("updates parent_id", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const task = await service.create({
        name: "Task",
        description: "Context",
      });

      const updated = await service.update({
        id: task.id,
        parent_id: parent.id,
      });

      expect(updated.parent_id).toBe(parent.id);
    });

    it("removes parent_id by setting to null", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const child = await service.create({
        name: "Child",
        description: "Context",
        parent_id: parent.id,
      });

      const updated = await service.update({
        id: child.id,
        parent_id: null,
      });

      expect(updated.parent_id).toBeNull();
    });

    it("throws when setting parent to self", async () => {
      const task = await service.create({
        name: "Task",
        description: "Context",
      });

      await expect(
        service.update({
          id: task.id,
          parent_id: task.id,
        }),
      ).rejects.toThrow("Task cannot be its own parent");
    });

    it("throws when parent would create cycle", async () => {
      const grandparent = await service.create({
        name: "Grandparent",
        description: "Context",
      });
      const parent = await service.create({
        name: "Parent",
        description: "Context",
        parent_id: grandparent.id,
      });
      const child = await service.create({
        name: "Child",
        description: "Context",
        parent_id: parent.id,
      });

      // Try to make grandparent a child of its descendant
      await expect(
        service.update({
          id: grandparent.id,
          parent_id: child.id,
        }),
      ).rejects.toThrow("Cannot set parent: would create a cycle");
    });

    it("throws when new parent does not exist", async () => {
      const task = await service.create({
        name: "Task",
        description: "Context",
      });

      await expect(
        service.update({
          id: task.id,
          parent_id: "nonexistent",
        }),
      ).rejects.toThrow('Task "nonexistent" not found');
    });
  });

  describe("delete", () => {
    it("deletes a task and returns it", async () => {
      const task = await service.create({
        name: "Test",
        description: "Context",
      });

      const deletedTask = await service.delete(task.id);
      expect(deletedTask.id).toBe(task.id);
      expect(deletedTask.name).toBe("Test");
      expect(await service.get(task.id)).toBeNull();
    });

    it("throws for nonexistent task", async () => {
      await expect(service.delete("nonexistent")).rejects.toThrow(
        'Task "nonexistent" not found',
      );
    });

    it("cascade deletes all descendants", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const child = await service.create({
        name: "Child",
        description: "Context",
        parent_id: parent.id,
      });
      const grandchild = await service.create({
        name: "Grandchild",
        description: "Context",
        parent_id: child.id,
      });

      await service.delete(parent.id);

      expect(await service.get(parent.id)).toBeNull();
      expect(await service.get(child.id)).toBeNull();
      expect(await service.get(grandchild.id)).toBeNull();
    });

    it("only deletes descendants, not siblings", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const child1 = await service.create({
        name: "Child 1",
        description: "Context",
        parent_id: parent.id,
      });
      const child2 = await service.create({
        name: "Child 2",
        description: "Context",
        parent_id: parent.id,
      });

      await service.delete(child1.id);

      expect(await service.get(child1.id)).toBeNull();
      expect(await service.get(child2.id)).not.toBeNull();
      expect(await service.get(parent.id)).not.toBeNull();
    });
  });

  describe("getChildren", () => {
    it("returns immediate children only", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const child1 = await service.create({
        name: "Child 1",
        description: "Context",
        parent_id: parent.id,
      });
      const child2 = await service.create({
        name: "Child 2",
        description: "Context",
        parent_id: parent.id,
      });
      await service.create({
        name: "Grandchild",
        description: "Context",
        parent_id: child1.id,
      });

      const children = await service.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain(child1.id);
      expect(children.map((c) => c.id)).toContain(child2.id);
    });

    it("returns empty array for task with no children", async () => {
      const task = await service.create({
        name: "Task",
        description: "Context",
      });

      const children = await service.getChildren(task.id);
      expect(children).toEqual([]);
    });
  });

  describe("list", () => {
    it("returns pending tasks by default", async () => {
      const pending = await service.create({
        name: "Pending",
        description: "Context",
      });
      const toComplete = await service.create({
        name: "Completed",
        description: "Context",
      });
      await service.update({
        id: toComplete.id,
        completed: true,
      });

      const tasks = await service.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(pending.id);
    });

    it("filters by completed", async () => {
      await service.create({ name: "Pending", description: "Context" });
      const completed = await service.create({
        name: "Completed",
        description: "Context",
      });
      await service.update({ id: completed.id, completed: true });

      const tasks = await service.list({ completed: true });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].completed).toBe(true);
    });

    it("returns all tasks when all flag is true", async () => {
      await service.create({ name: "Pending", description: "Context" });
      const completed = await service.create({
        name: "Completed",
        description: "Context",
      });
      await service.update({ id: completed.id, completed: true });

      const tasks = await service.list({ all: true });
      expect(tasks).toHaveLength(2);
    });

    it("filters by query in description", async () => {
      await service.create({
        name: "Fix the bug",
        description: "Context",
      });
      await service.create({
        name: "Add feature",
        description: "Context",
      });

      const tasks = await service.list({ query: "bug" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Fix the bug");
    });

    it("filters by query in context", async () => {
      await service.create({
        name: "Task 1",
        description: "Related to authentication",
      });
      await service.create({
        name: "Task 2",
        description: "Related to UI",
      });

      const tasks = await service.list({ query: "authentication" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Task 1");
    });

    it("sorts by priority ascending", async () => {
      await service.create({
        name: "Low priority",
        description: "Context",
        priority: 10,
      });
      await service.create({
        name: "High priority",
        description: "Context",
        priority: 1,
      });
      await service.create({
        name: "Medium priority",
        description: "Context",
        priority: 5,
      });

      const tasks = await service.list();
      expect(tasks[0].name).toBe("High priority");
      expect(tasks[1].name).toBe("Medium priority");
      expect(tasks[2].name).toBe("Low priority");
    });

    it("returns empty array when no tasks match", async () => {
      const tasks = await service.list();
      expect(tasks).toEqual([]);
    });
  });

  describe("complete", () => {
    it("marks task as completed with result", async () => {
      const task = await service.create({
        name: "Test",
        description: "Context",
      });

      const completed = await service.complete(task.id, "Done successfully");

      expect(completed.completed).toBe(true);
      expect(completed.result).toBe("Done successfully");
    });

    it("throws when task has pending children", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      await service.create({
        name: "Child",
        description: "Context",
        parent_id: parent.id,
      });

      await expect(service.complete(parent.id, "Done")).rejects.toThrow(
        "Cannot complete: 1 subtask still pending",
      );
    });

    it("throws when task has multiple pending children", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      await service.create({
        name: "Child 1",
        description: "Context",
        parent_id: parent.id,
      });
      await service.create({
        name: "Child 2",
        description: "Context",
        parent_id: parent.id,
      });

      await expect(service.complete(parent.id, "Done")).rejects.toThrow(
        "Cannot complete: 2 subtasks still pending",
      );
    });

    it("throws when task has pending grandchildren", async () => {
      const grandparent = await service.create({
        name: "Grandparent",
        description: "Context",
      });
      const parent = await service.create({
        name: "Parent",
        description: "Context",
        parent_id: grandparent.id,
      });
      await service.update({ id: parent.id, completed: true });

      await service.create({
        name: "Grandchild",
        description: "Context",
        parent_id: parent.id,
      });

      await expect(service.complete(grandparent.id, "Done")).rejects.toThrow(
        "Cannot complete: 1 subtask still pending",
      );
    });

    it("allows completion when all descendants are completed", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const child = await service.create({
        name: "Child",
        description: "Context",
        parent_id: parent.id,
      });
      await service.update({ id: child.id, completed: true });

      const completed = await service.complete(parent.id, "Done");
      expect(completed.completed).toBe(true);
    });

    it("auto-sets started_at when completing a task that was never started", async () => {
      const task = await service.create({
        name: "Never started",
        description: "Context",
      });

      expect(task.started_at).toBeNull();

      const completed = await service.complete(task.id, "Done");

      expect(completed.completed).toBe(true);
      expect(completed.started_at).toBeTruthy();
      // started_at should be set to approximately the same time as completed_at
      expect(completed.started_at).toBe(completed.completed_at);
    });

    it("preserves started_at when completing a task that was already started", async () => {
      const task = await service.create({
        name: "Already started",
        description: "Context",
      });

      await service.start(task.id);
      const started = await service.get(task.id);
      const originalStartedAt = started?.started_at;

      // Wait a tiny bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const completed = await service.complete(task.id, "Done");

      expect(completed.completed).toBe(true);
      expect(completed.started_at).toBe(originalStartedAt);
    });
  });

  describe("start", () => {
    it("marks a task as in progress", async () => {
      const task = await service.create({
        name: "To start",
        description: "Context",
      });

      expect(task.started_at).toBeNull();

      const started = await service.start(task.id);

      expect(started.started_at).toBeTruthy();
      expect(started.completed).toBe(false);
    });

    it("throws for nonexistent task", async () => {
      await expect(
        async () => await service.start("nonexistent"),
      ).rejects.toThrow('Task "nonexistent" not found');
    });

    it("throws when starting a completed task", async () => {
      const task = await service.create({
        name: "To complete",
        description: "Context",
      });
      await service.complete(task.id, "Done");

      await expect(async () => await service.start(task.id)).rejects.toThrow(
        "Cannot start a completed task",
      );
    });

    it("throws when starting an already-started task without force", async () => {
      const task = await service.create({
        name: "To start",
        description: "Context",
      });
      await service.start(task.id);

      await expect(async () => await service.start(task.id)).rejects.toThrow(
        "already in progress",
      );
    });

    it("allows re-starting with force flag", async () => {
      const task = await service.create({
        name: "To start",
        description: "Context",
      });
      await service.start(task.id);
      const started = await service.get(task.id);
      const originalStartedAt = started?.started_at;

      // Wait a tiny bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const restarted = await service.start(task.id, { force: true });

      expect(restarted.started_at).toBeTruthy();
      expect(restarted.started_at).not.toBe(originalStartedAt);
    });
  });

  describe("getStoragePath", () => {
    it("returns the storage path", () => {
      expect(service.getStoragePath()).toBe(storagePath);
    });
  });

  describe("blocking relationships", () => {
    it("throws when adding blocker would create a cycle", async () => {
      // A blocks B, B blocks C - adding C blocks A should fail
      const taskA = await service.create({
        name: "Task A",
        description: "Context",
      });
      const taskB = await service.create({
        name: "Task B",
        description: "Context",
        blocked_by: [taskA.id],
      });
      const taskC = await service.create({
        name: "Task C",
        description: "Context",
        blocked_by: [taskB.id],
      });

      // Try to make C block A (would create cycle: A -> B -> C -> A)
      await expect(
        service.update({
          id: taskA.id,
          add_blocked_by: [taskC.id],
        }),
      ).rejects.toThrow("would create a cycle");
    });

    it("throws when task blocks itself", async () => {
      const task = await service.create({
        name: "Task",
        description: "Context",
      });

      await expect(
        service.update({
          id: task.id,
          add_blocked_by: [task.id],
        }),
      ).rejects.toThrow("Task cannot block itself");
    });

    it("throws when blocker task does not exist", async () => {
      const task = await service.create({
        name: "Task",
        description: "Context",
      });

      await expect(
        service.update({
          id: task.id,
          add_blocked_by: ["nonexistent"],
        }),
      ).rejects.toThrow('Task "nonexistent" not found');
    });
  });

  describe("getAncestors", () => {
    it("returns empty array for root task", async () => {
      const task = await service.create({
        name: "Root task",
        description: "Context",
      });

      const ancestors = await service.getAncestors(task.id);
      expect(ancestors).toEqual([]);
    });

    it("returns parent for first-level child", async () => {
      const parent = await service.create({
        name: "Parent",
        description: "Context",
      });
      const child = await service.create({
        name: "Child",
        description: "Context",
        parent_id: parent.id,
      });

      const ancestors = await service.getAncestors(child.id);
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].id).toBe(parent.id);
    });

    it("returns ancestors from root to immediate parent", async () => {
      const epic = await service.create({
        name: "Epic",
        description: "Context",
      });
      const task = await service.create({
        name: "Task",
        description: "Context",
        parent_id: epic.id,
      });
      const subtask = await service.create({
        name: "Subtask",
        description: "Context",
        parent_id: task.id,
      });

      const ancestors = await service.getAncestors(subtask.id);
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0].id).toBe(epic.id);
      expect(ancestors[1].id).toBe(task.id);
    });
  });

  describe("getDepth", () => {
    it("returns 0 for root task", async () => {
      const task = await service.create({
        name: "Root",
        description: "Context",
      });

      const depth = await service.getDepth(task.id);
      expect(depth).toBe(0);
    });

    it("returns 1 for task under epic", async () => {
      const epic = await service.create({
        name: "Epic",
        description: "Context",
      });
      const task = await service.create({
        name: "Task",
        description: "Context",
        parent_id: epic.id,
      });

      const depth = await service.getDepth(task.id);
      expect(depth).toBe(1);
    });

    it("returns 2 for subtask", async () => {
      const epic = await service.create({
        name: "Epic",
        description: "Context",
      });
      const task = await service.create({
        name: "Task",
        description: "Context",
        parent_id: epic.id,
      });
      const subtask = await service.create({
        name: "Subtask",
        description: "Context",
        parent_id: task.id,
      });

      const depth = await service.getDepth(subtask.id);
      expect(depth).toBe(2);
    });
  });

  describe("depth validation", () => {
    it("allows creating 3-level hierarchy", async () => {
      const epic = await service.create({
        name: "Epic",
        description: "Context",
      });
      const task = await service.create({
        name: "Task",
        description: "Context",
        parent_id: epic.id,
      });
      const subtask = await service.create({
        name: "Subtask",
        description: "Context",
        parent_id: task.id,
      });

      expect(subtask.parent_id).toBe(task.id);
    });

    it("rejects creating child of subtask (4th level)", async () => {
      const epic = await service.create({
        name: "Epic",
        description: "Context",
      });
      const task = await service.create({
        name: "Task",
        description: "Context",
        parent_id: epic.id,
      });
      const subtask = await service.create({
        name: "Subtask",
        description: "Context",
        parent_id: task.id,
      });

      await expect(
        service.create({
          name: "Too deep",
          description: "Context",
          parent_id: subtask.id,
        }),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.create({
          name: "Too deep",
          description: "Context",
          parent_id: subtask.id,
        }),
      ).rejects.toThrow("maximum depth");
    });

    it("rejects moving task to exceed depth limit", async () => {
      // Create a task with a subtask
      const task = await service.create({
        name: "Task with subtask",
        description: "Context",
      });
      const subtask = await service.create({
        name: "Subtask",
        description: "Context",
        parent_id: task.id,
      });

      // Create an epic with a task
      const epic = await service.create({
        name: "Epic",
        description: "Context",
      });
      const epicTask = await service.create({
        name: "Epic task",
        description: "Context",
        parent_id: epic.id,
      });

      // Try to move "task with subtask" under epicTask
      // This would make subtask at depth 4 (epic -> epicTask -> task -> subtask)
      await expect(
        service.update({
          id: task.id,
          parent_id: epicTask.id,
        }),
      ).rejects.toThrow("maximum depth");
    });
  });

  describe("autosync", () => {
    let mockSyncService: {
      syncTask: ReturnType<typeof vi.fn>;
      getRepo: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockSyncService = {
        syncTask: vi.fn(),
        getRepo: vi.fn(() => ({ owner: "test", repo: "test" })),
      };
    });

    it("saves GitHub metadata when autosync creates an issue", async () => {
      // Mock syncTask to return the task ID it was called with
      mockSyncService.syncTask.mockImplementation(async (task) => ({
        taskId: task.id,
        github: {
          issueNumber: 42,
          issueUrl: "https://github.com/test/test/issues/42",
          repo: "test/test",
          state: "open",
        },
        created: true,
      }));

      const syncService = new TaskService({
        storage: storagePath,
        syncService: mockSyncService as unknown as GitHubSyncService,
        syncConfig: { enabled: true, auto: { on_change: true } },
      });

      const task = await syncService.create({
        name: "Test task",
        description: "Test",
      });

      expect(mockSyncService.syncTask).toHaveBeenCalled();

      // Fetch the task from storage to verify metadata was saved
      const savedTask = await syncService.get(task.id);
      expect(savedTask?.metadata?.github).toEqual({
        issueNumber: 42,
        issueUrl: "https://github.com/test/test/issues/42",
        repo: "test/test",
        state: "open",
      });
    });

    it("saves GitHub metadata when autosync updates an issue", async () => {
      // First create a task without sync
      const noSyncService = new TaskService({ storage: storagePath });
      const task = await noSyncService.create({
        name: "Test task",
        description: "Test",
      });

      // Now create a service with sync enabled
      mockSyncService.syncTask.mockResolvedValue({
        taskId: task.id,
        github: {
          issueNumber: 99,
          issueUrl: "https://github.com/test/test/issues/99",
          repo: "test/test",
          state: "open",
        },
        created: false,
      });

      const syncService = new TaskService({
        storage: storagePath,
        syncService: mockSyncService as unknown as GitHubSyncService,
        syncConfig: { enabled: true, auto: { on_change: true } },
      });

      await syncService.update({
        id: task.id,
        name: "Updated name",
      });

      const savedTask = await syncService.get(task.id);
      expect(savedTask?.metadata?.github?.issueNumber).toBe(99);
    });

    it("preserves existing metadata when saving GitHub metadata", async () => {
      // First create a task with commit metadata
      const noSyncService = new TaskService({ storage: storagePath });
      const task = await noSyncService.create({
        name: "Test task",
        description: "Test",
        metadata: {
          commit: {
            sha: "abc123",
            message: "Initial commit",
          },
        },
      });

      // Now update with sync enabled
      mockSyncService.syncTask.mockResolvedValue({
        taskId: task.id,
        github: {
          issueNumber: 55,
          issueUrl: "https://github.com/test/test/issues/55",
          repo: "test/test",
          state: "open",
        },
        created: false,
      });

      const syncService = new TaskService({
        storage: storagePath,
        syncService: mockSyncService as unknown as GitHubSyncService,
        syncConfig: { enabled: true, auto: { on_change: true } },
      });

      await syncService.update({
        id: task.id,
        name: "Updated name",
      });

      const savedTask = await syncService.get(task.id);
      // GitHub metadata should be added
      expect(savedTask?.metadata?.github?.issueNumber).toBe(55);
      // Commit metadata should be preserved
      expect(savedTask?.metadata?.commit?.sha).toBe("abc123");
    });

    it("does not save metadata when autosync is skipped", async () => {
      // First create a task
      const noSyncService = new TaskService({ storage: storagePath });
      const task = await noSyncService.create({
        name: "Test task",
        description: "Test",
      });
      const originalUpdatedAt = task.updated_at;

      // Wait a bit to ensure timestamp would change
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Sync returns skipped: true
      mockSyncService.syncTask.mockResolvedValue({
        taskId: task.id,
        github: {
          issueNumber: 77,
          issueUrl: "https://github.com/test/test/issues/77",
          repo: "test/test",
          state: "open",
        },
        created: false,
        skipped: true,
      });

      const syncService = new TaskService({
        storage: storagePath,
        syncService: mockSyncService as unknown as GitHubSyncService,
        syncConfig: { enabled: true, auto: { on_change: true } },
      });

      await syncService.update({
        id: task.id,
        name: "Updated name",
      });

      const savedTask = await syncService.get(task.id);
      // GitHub metadata should NOT be saved when skipped
      expect(savedTask?.metadata?.github).toBeUndefined();
    });

    it("handles subtask sync (saves to parent)", async () => {
      // First create parent and subtask
      const noSyncService = new TaskService({ storage: storagePath });
      const parent = await noSyncService.create({
        name: "Parent task",
        description: "Parent",
      });
      const subtask = await noSyncService.create({
        name: "Subtask",
        description: "Child",
        parent_id: parent.id,
      });

      // Sync service returns parent's ID (subtasks sync their parent)
      mockSyncService.syncTask.mockResolvedValue({
        taskId: parent.id, // Parent gets the GitHub issue, not subtask
        github: {
          issueNumber: 88,
          issueUrl: "https://github.com/test/test/issues/88",
          repo: "test/test",
          state: "open",
        },
        created: false,
      });

      const syncService = new TaskService({
        storage: storagePath,
        syncService: mockSyncService as unknown as GitHubSyncService,
        syncConfig: { enabled: true, auto: { on_change: true } },
      });

      // Update subtask triggers sync
      await syncService.update({
        id: subtask.id,
        name: "Updated subtask",
      });

      // Parent should have GitHub metadata
      const savedParent = await syncService.get(parent.id);
      expect(savedParent?.metadata?.github?.issueNumber).toBe(88);

      // Subtask should NOT have GitHub metadata (only parent gets it)
      const savedSubtask = await syncService.get(subtask.id);
      expect(savedSubtask?.metadata?.github).toBeUndefined();
    });
  });
});
