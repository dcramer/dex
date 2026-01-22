import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TaskService } from "../src/core/task-service.js";

describe("TaskService", () => {
  let tempDir: string;
  let storagePath: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-test-"));
    storagePath = path.join(tempDir, "tasks.json");
    service = new TaskService(storagePath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a task with required fields", () => {
      const task = service.create({
        description: "Test task",
        context: "Test context",
      });

      expect(task.id).toBeDefined();
      expect(task.description).toBe("Test task");
      expect(task.context).toBe("Test context");
      expect(task.status).toBe("pending");
      expect(task.project).toBe("default");
      expect(task.priority).toBe(1);
      expect(task.parent_id).toBeNull();
      expect(task.result).toBeNull();
    });

    it("creates a task with custom project and priority", () => {
      const task = service.create({
        description: "Test task",
        context: "Test context",
        project: "my-project",
        priority: 5,
      });

      expect(task.project).toBe("my-project");
      expect(task.priority).toBe(5);
    });

    it("creates a child task with parent_id", () => {
      const parent = service.create({
        description: "Parent task",
        context: "Parent context",
        project: "test-project",
      });

      const child = service.create({
        description: "Child task",
        context: "Child context",
        parent_id: parent.id,
      });

      expect(child.parent_id).toBe(parent.id);
      expect(child.project).toBe("test-project"); // Inherits from parent
    });

    it("throws when parent task does not exist", () => {
      expect(() =>
        service.create({
          description: "Orphan task",
          context: "Context",
          parent_id: "nonexistent",
        })
      ).toThrow('Task "nonexistent" not found');
    });

    it("uses explicit project over inherited project", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
        project: "parent-project",
      });

      const child = service.create({
        description: "Child",
        context: "Context",
        parent_id: parent.id,
        project: "child-project",
      });

      expect(child.project).toBe("child-project");
    });
  });

  describe("get", () => {
    it("returns task by id", () => {
      const created = service.create({
        description: "Test",
        context: "Context",
      });

      const retrieved = service.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it("returns null for nonexistent task", () => {
      const result = service.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("updates task description", () => {
      const task = service.create({
        description: "Original",
        context: "Context",
      });

      const updated = service.update({
        id: task.id,
        description: "Updated",
      });

      expect(updated.description).toBe("Updated");
      expect(updated.context).toBe("Context");
    });

    it("updates multiple fields", () => {
      const task = service.create({
        description: "Test",
        context: "Context",
      });

      const updated = service.update({
        id: task.id,
        description: "New description",
        context: "New context",
        priority: 10,
        project: "new-project",
      });

      expect(updated.description).toBe("New description");
      expect(updated.context).toBe("New context");
      expect(updated.priority).toBe(10);
      expect(updated.project).toBe("new-project");
    });

    it("throws when task does not exist", () => {
      expect(() =>
        service.update({
          id: "nonexistent",
          description: "Updated",
        })
      ).toThrow('Task "nonexistent" not found');
    });

    it("deletes task via update with delete flag", () => {
      const task = service.create({
        description: "To delete",
        context: "Context",
      });

      const deleted = service.update({
        id: task.id,
        delete: true,
      });

      expect(deleted.id).toBe(task.id);
      expect(service.get(task.id)).toBeNull();
    });

    it("updates parent_id", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      const task = service.create({
        description: "Task",
        context: "Context",
      });

      const updated = service.update({
        id: task.id,
        parent_id: parent.id,
      });

      expect(updated.parent_id).toBe(parent.id);
    });

    it("removes parent_id by setting to null", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      const child = service.create({
        description: "Child",
        context: "Context",
        parent_id: parent.id,
      });

      const updated = service.update({
        id: child.id,
        parent_id: null,
      });

      expect(updated.parent_id).toBeNull();
    });

    it("throws when setting parent to self", () => {
      const task = service.create({
        description: "Task",
        context: "Context",
      });

      expect(() =>
        service.update({
          id: task.id,
          parent_id: task.id,
        })
      ).toThrow("Task cannot be its own parent");
    });

    it("throws when parent would create cycle", () => {
      const grandparent = service.create({
        description: "Grandparent",
        context: "Context",
      });
      const parent = service.create({
        description: "Parent",
        context: "Context",
        parent_id: grandparent.id,
      });
      const child = service.create({
        description: "Child",
        context: "Context",
        parent_id: parent.id,
      });

      // Try to make grandparent a child of its descendant
      expect(() =>
        service.update({
          id: grandparent.id,
          parent_id: child.id,
        })
      ).toThrow("Cannot set parent: would create a cycle");
    });

    it("throws when new parent does not exist", () => {
      const task = service.create({
        description: "Task",
        context: "Context",
      });

      expect(() =>
        service.update({
          id: task.id,
          parent_id: "nonexistent",
        })
      ).toThrow('Task "nonexistent" not found');
    });
  });

  describe("delete", () => {
    it("deletes a task and returns it", () => {
      const task = service.create({
        description: "Test",
        context: "Context",
      });

      const deletedTask = service.delete(task.id);
      expect(deletedTask.id).toBe(task.id);
      expect(deletedTask.description).toBe("Test");
      expect(service.get(task.id)).toBeNull();
    });

    it("throws for nonexistent task", () => {
      expect(() => service.delete("nonexistent")).toThrow(
        'Task "nonexistent" not found'
      );
    });

    it("cascade deletes all descendants", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      const child = service.create({
        description: "Child",
        context: "Context",
        parent_id: parent.id,
      });
      const grandchild = service.create({
        description: "Grandchild",
        context: "Context",
        parent_id: child.id,
      });

      service.delete(parent.id);

      expect(service.get(parent.id)).toBeNull();
      expect(service.get(child.id)).toBeNull();
      expect(service.get(grandchild.id)).toBeNull();
    });

    it("only deletes descendants, not siblings", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      const child1 = service.create({
        description: "Child 1",
        context: "Context",
        parent_id: parent.id,
      });
      const child2 = service.create({
        description: "Child 2",
        context: "Context",
        parent_id: parent.id,
      });

      service.delete(child1.id);

      expect(service.get(child1.id)).toBeNull();
      expect(service.get(child2.id)).not.toBeNull();
      expect(service.get(parent.id)).not.toBeNull();
    });
  });

  describe("getChildren", () => {
    it("returns immediate children only", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      const child1 = service.create({
        description: "Child 1",
        context: "Context",
        parent_id: parent.id,
      });
      const child2 = service.create({
        description: "Child 2",
        context: "Context",
        parent_id: parent.id,
      });
      service.create({
        description: "Grandchild",
        context: "Context",
        parent_id: child1.id,
      });

      const children = service.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain(child1.id);
      expect(children.map((c) => c.id)).toContain(child2.id);
    });

    it("returns empty array for task with no children", () => {
      const task = service.create({
        description: "Task",
        context: "Context",
      });

      const children = service.getChildren(task.id);
      expect(children).toEqual([]);
    });
  });

  describe("list", () => {
    it("returns pending tasks by default", () => {
      const pending = service.create({
        description: "Pending",
        context: "Context",
      });
      const toComplete = service.create({
        description: "Completed",
        context: "Context",
      });
      service.update({
        id: toComplete.id,
        status: "completed",
      });

      const tasks = service.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(pending.id);
    });

    it("filters by status", () => {
      service.create({ description: "Pending", context: "Context" });
      const completed = service.create({
        description: "Completed",
        context: "Context",
      });
      service.update({ id: completed.id, status: "completed" });

      const tasks = service.list({ status: "completed" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("completed");
    });

    it("returns all tasks when all flag is true", () => {
      service.create({ description: "Pending", context: "Context" });
      const completed = service.create({
        description: "Completed",
        context: "Context",
      });
      service.update({ id: completed.id, status: "completed" });

      const tasks = service.list({ all: true });
      expect(tasks).toHaveLength(2);
    });

    it("filters by project", () => {
      service.create({
        description: "Project A",
        context: "Context",
        project: "a",
      });
      service.create({
        description: "Project B",
        context: "Context",
        project: "b",
      });

      const tasks = service.list({ project: "a" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].project).toBe("a");
    });

    it("filters by query in description", () => {
      service.create({
        description: "Fix the bug",
        context: "Context",
      });
      service.create({
        description: "Add feature",
        context: "Context",
      });

      const tasks = service.list({ query: "bug" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Fix the bug");
    });

    it("filters by query in context", () => {
      service.create({
        description: "Task 1",
        context: "Related to authentication",
      });
      service.create({
        description: "Task 2",
        context: "Related to UI",
      });

      const tasks = service.list({ query: "authentication" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Task 1");
    });

    it("sorts by priority ascending", () => {
      service.create({
        description: "Low priority",
        context: "Context",
        priority: 10,
      });
      service.create({
        description: "High priority",
        context: "Context",
        priority: 1,
      });
      service.create({
        description: "Medium priority",
        context: "Context",
        priority: 5,
      });

      const tasks = service.list();
      expect(tasks[0].description).toBe("High priority");
      expect(tasks[1].description).toBe("Medium priority");
      expect(tasks[2].description).toBe("Low priority");
    });

    it("returns empty array when no tasks match", () => {
      const tasks = service.list();
      expect(tasks).toEqual([]);
    });
  });

  describe("listProjects", () => {
    it("returns project counts", () => {
      service.create({
        description: "Task 1",
        context: "Context",
        project: "project-a",
      });
      service.create({
        description: "Task 2",
        context: "Context",
        project: "project-a",
      });
      const completedTask = service.create({
        description: "Task 3",
        context: "Context",
        project: "project-a",
      });
      service.update({ id: completedTask.id, status: "completed" });

      service.create({
        description: "Task 4",
        context: "Context",
        project: "project-b",
      });

      const projects = service.listProjects();
      expect(projects).toHaveLength(2);

      const projectA = projects.find((p) => p.project === "project-a");
      expect(projectA).toEqual({
        project: "project-a",
        pending: 2,
        completed: 1,
      });

      const projectB = projects.find((p) => p.project === "project-b");
      expect(projectB).toEqual({
        project: "project-b",
        pending: 1,
        completed: 0,
      });
    });

    it("returns empty array when no tasks exist", () => {
      const projects = service.listProjects();
      expect(projects).toEqual([]);
    });
  });

  describe("complete", () => {
    it("marks task as completed with result", () => {
      const task = service.create({
        description: "Test",
        context: "Context",
      });

      const completed = service.complete(task.id, "Done successfully");

      expect(completed.status).toBe("completed");
      expect(completed.result).toBe("Done successfully");
    });

    it("throws when task has pending children", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      service.create({
        description: "Child",
        context: "Context",
        parent_id: parent.id,
      });

      expect(() => service.complete(parent.id, "Done")).toThrow(
        "Cannot complete: 1 subtask still pending"
      );
    });

    it("throws when task has multiple pending children", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      service.create({
        description: "Child 1",
        context: "Context",
        parent_id: parent.id,
      });
      service.create({
        description: "Child 2",
        context: "Context",
        parent_id: parent.id,
      });

      expect(() => service.complete(parent.id, "Done")).toThrow(
        "Cannot complete: 2 subtasks still pending"
      );
    });

    it("throws when task has pending grandchildren", () => {
      const grandparent = service.create({
        description: "Grandparent",
        context: "Context",
      });
      const parent = service.create({
        description: "Parent",
        context: "Context",
        parent_id: grandparent.id,
      });
      service.update({ id: parent.id, status: "completed" });

      service.create({
        description: "Grandchild",
        context: "Context",
        parent_id: parent.id,
      });

      expect(() => service.complete(grandparent.id, "Done")).toThrow(
        "Cannot complete: 1 subtask still pending"
      );
    });

    it("allows completion when all descendants are completed", () => {
      const parent = service.create({
        description: "Parent",
        context: "Context",
      });
      const child = service.create({
        description: "Child",
        context: "Context",
        parent_id: parent.id,
      });
      service.update({ id: child.id, status: "completed" });

      const completed = service.complete(parent.id, "Done");
      expect(completed.status).toBe("completed");
    });
  });

  describe("getStoragePath", () => {
    it("returns the storage path", () => {
      expect(service.getStoragePath()).toBe(storagePath);
    });
  });
});
