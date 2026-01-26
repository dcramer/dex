import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Task } from "../types.js";
import {
  createMcpTestContext,
  parseToolResponse,
  isErrorResult,
  McpTestContext,
} from "./test-helpers.js";

describe("MCP Server", () => {
  let ctx: McpTestContext;

  beforeEach(async () => {
    ctx = await createMcpTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function createTask(args: {
    name: string;
    description?: string;
    blocked_by?: string[];
    parent_id?: string;
    priority?: number;
  }): Promise<Task> {
    const result = await ctx.client.callTool({
      name: "create_task",
      arguments: { description: "Description", ...args },
    });
    return parseToolResponse<Task>(result);
  }

  async function createBlockerAndBlockedTask(): Promise<{
    blocker: Task;
    blocked: Task;
  }> {
    const blocker = await createTask({ name: "Blocker" });
    const blocked = await createTask({
      name: "Blocked task",
      blocked_by: [blocker.id],
    });
    return { blocker, blocked };
  }

  describe("listTools", () => {
    it("exposes all 3 tools", async () => {
      const result = await ctx.client.listTools();

      expect(result.tools).toHaveLength(3);

      const toolNames = result.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(["create_task", "list_tasks", "update_task"]);
    });

    it("each tool has description and input schema", async () => {
      const result = await ctx.client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  describe("create_task", () => {
    it("creates a task with required fields", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Test task",
          description: "Test description for the task",
        },
      });

      const task = parseToolResponse<Task>(result);

      expect(task.id).toBeDefined();
      expect(task.name).toBe("Test task");
      expect(task.description).toBe("Test description for the task");
      expect(task.completed).toBe(false);
      expect(task.priority).toBe(1);
      expect(task.parent_id).toBeNull();
    });

    it("creates a task with optional priority", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "High priority task",
          description: "Urgent work",
          priority: 5,
        },
      });

      const task = parseToolResponse<Task>(result);
      expect(task.priority).toBe(5);
    });

    it("creates a subtask with parent_id", async () => {
      // Create parent task
      const parentResult = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Parent task",
          description: "Parent context",
        },
      });
      const parent = parseToolResponse<Task>(parentResult);

      // Create subtask
      const subtaskResult = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Subtask",
          description: "Subtask context",
          parent_id: parent.id,
        },
      });
      const subtask = parseToolResponse<Task>(subtaskResult);

      expect(subtask.parent_id).toBe(parent.id);
    });

    it("returns validation error for missing description", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          description: "Only context, no description",
        },
      });

      expect(isErrorResult(result)).toBe(true);
    });

    it("returns validation error for missing context", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Only description, no context",
        },
      });

      expect(isErrorResult(result)).toBe(true);
    });

    it("returns error for non-existent parent_id", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Orphan subtask",
          description: "Context",
          parent_id: "nonexistent123",
        },
      });

      expect(isErrorResult(result)).toBe(true);
      const response = parseToolResponse<{ error: string }>(result);
      expect(response.error).toContain("not found");
    });

    it("creates a task with blocked_by dependencies", async () => {
      const { blocker, blocked } = await createBlockerAndBlockedTask();
      expect(blocked.blockedBy).toContain(blocker.id);
    });

    it("returns error for non-existent blocked_by id", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Task with bad blocker",
          description: "Context",
          blocked_by: ["nonexistent123"],
        },
      });

      expect(isErrorResult(result)).toBe(true);
      const response = parseToolResponse<{ error: string }>(result);
      expect(response.error).toContain("not found");
    });
  });

  describe("list_tasks", () => {
    it("returns empty list when no tasks exist", async () => {
      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: {},
      });

      const tasks = parseToolResponse<Task[]>(result);
      expect(tasks).toEqual([]);
    });

    it("returns pending tasks by default", async () => {
      // Create a pending and a completed task
      await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Pending task", description: "Context" },
      });

      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "To be completed", description: "Context" },
      });
      const toComplete = parseToolResponse<Task>(createResult);

      await ctx.client.callTool({
        name: "update_task",
        arguments: { id: toComplete.id, completed: true, result: "Done" },
      });

      // List without filters (should only show pending)
      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: {},
      });

      const tasks = parseToolResponse<Task[]>(result);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Pending task");
    });

    it("filters by completed", async () => {
      // Create tasks
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Task to complete", description: "Context" },
      });
      const task = parseToolResponse<Task>(createResult);

      await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, completed: true, result: "Done" },
      });

      // Filter by completed
      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: { completed: true },
      });

      const tasks = parseToolResponse<Task[]>(result);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].completed).toBe(true);
    });

    it("returns all tasks with all flag", async () => {
      // Create one pending and one completed
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Pending", description: "Context" },
      });
      const pending = parseToolResponse<Task>(createResult);

      const createResult2 = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Completed", description: "Context" },
      });
      const toComplete = parseToolResponse<Task>(createResult2);

      await ctx.client.callTool({
        name: "update_task",
        arguments: { id: toComplete.id, completed: true, result: "Done" },
      });

      // List all
      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: { all: true },
      });

      const tasks = parseToolResponse<Task[]>(result);
      expect(tasks).toHaveLength(2);
    });

    it("searches by query", async () => {
      await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Fix authentication bug",
          description: "Auth context",
        },
      });
      await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Add new feature", description: "Feature context" },
      });

      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: { query: "authentication" },
      });

      const tasks = parseToolResponse<Task[]>(result);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toContain("authentication");
    });

    it("filters blocked tasks", async () => {
      await createBlockerAndBlockedTask();
      await createTask({ name: "Unblocked task" });

      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: { blocked: true },
      });

      const tasks = parseToolResponse<Task[]>(result);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Blocked task");
    });

    it("filters ready tasks (unblocked pending)", async () => {
      await createBlockerAndBlockedTask();
      await createTask({ name: "Ready task" });

      const result = await ctx.client.callTool({
        name: "list_tasks",
        arguments: { ready: true },
      });

      const tasks = parseToolResponse<Task[]>(result);
      // Blocker and Ready task are both ready (no incomplete blockers)
      expect(tasks).toHaveLength(2);
      const names = tasks.map((t) => t.name);
      expect(names).toContain("Blocker");
      expect(names).toContain("Ready task");
      expect(names).not.toContain("Blocked task");
    });
  });

  describe("update_task", () => {
    it("updates task name", async () => {
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Original", description: "Context" },
      });
      const task = parseToolResponse<Task>(createResult);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, name: "Updated" },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.name).toBe("Updated");
    });

    it("updates task description", async () => {
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Task", description: "Original description" },
      });
      const task = parseToolResponse<Task>(createResult);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, description: "Updated description" },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.description).toBe("Updated description");
    });

    it("updates task priority", async () => {
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Task", description: "Context" },
      });
      const task = parseToolResponse<Task>(createResult);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, priority: 10 },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.priority).toBe(10);
    });

    it("completes a task with result", async () => {
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Task to complete", description: "Context" },
      });
      const task = parseToolResponse<Task>(createResult);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: {
          id: task.id,
          completed: true,
          result: "Task completed successfully with these changes...",
        },
      });

      const completed = parseToolResponse<Task>(updateResult);
      expect(completed.completed).toBe(true);
      expect(completed.result).toBe(
        "Task completed successfully with these changes...",
      );
      expect(completed.completed_at).toBeTruthy();
    });

    it("deletes a task", async () => {
      const createResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Task to delete", description: "Context" },
      });
      const task = parseToolResponse<Task>(createResult);

      const deleteResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, delete: true },
      });

      const response = parseToolResponse<{ deleted: boolean; id: string }>(
        deleteResult,
      );
      expect(response.deleted).toBe(true);
      expect(response.id).toBe(task.id);

      // Verify task is gone
      const listResult = await ctx.client.callTool({
        name: "list_tasks",
        arguments: { all: true },
      });
      const tasks = parseToolResponse<Task[]>(listResult);
      expect(tasks).toHaveLength(0);
    });

    it("returns error for non-existent task", async () => {
      const result = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: "nonexistent123", name: "New name" },
      });

      expect(isErrorResult(result)).toBe(true);
      const response = parseToolResponse<{ error: string }>(result);
      expect(response.error).toContain("not found");
    });

    it("returns validation error for missing id", async () => {
      const result = await ctx.client.callTool({
        name: "update_task",
        arguments: { name: "No ID provided" },
      });

      expect(isErrorResult(result)).toBe(true);
    });

    it("updates parent_id to create subtask relationship", async () => {
      const parentResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Parent", description: "Context" },
      });
      const parent = parseToolResponse<Task>(parentResult);

      const childResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Child", description: "Context" },
      });
      const child = parseToolResponse<Task>(childResult);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: child.id, parent_id: parent.id },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.parent_id).toBe(parent.id);
    });

    it("removes parent_id by setting to null", async () => {
      const parentResult = await ctx.client.callTool({
        name: "create_task",
        arguments: { name: "Parent", description: "Context" },
      });
      const parent = parseToolResponse<Task>(parentResult);

      const childResult = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Child",
          description: "Context",
          parent_id: parent.id,
        },
      });
      const child = parseToolResponse<Task>(childResult);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: child.id, parent_id: null },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.parent_id).toBeNull();
    });

    it("adds commit metadata when completing task", async () => {
      const task = await createTask({ name: "Task with commit" });

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: {
          id: task.id,
          completed: true,
          result: "Implemented the feature",
          commit_sha: "abc123def",
          commit_message: "feat: add new feature",
          commit_branch: "feature-branch",
          commit_url: "https://github.com/org/repo/commit/abc123def",
        },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.completed).toBe(true);
      expect(updated.metadata?.commit).toBeDefined();
      expect(updated.metadata?.commit?.sha).toBe("abc123def");
      expect(updated.metadata?.commit?.message).toBe("feat: add new feature");
      expect(updated.metadata?.commit?.branch).toBe("feature-branch");
      expect(updated.metadata?.commit?.url).toBe(
        "https://github.com/org/repo/commit/abc123def",
      );
      expect(updated.metadata?.commit?.timestamp).toBeDefined();
    });

    it("adds blocked_by dependencies", async () => {
      const blocker = await createTask({ name: "Blocker" });
      const task = await createTask({ name: "Task" });

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, add_blocked_by: [blocker.id] },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.blockedBy).toContain(blocker.id);
    });

    it("removes blocked_by dependencies", async () => {
      const { blocker, blocked } = await createBlockerAndBlockedTask();
      expect(blocked.blockedBy).toContain(blocker.id);

      const updateResult = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: blocked.id, remove_blocked_by: [blocker.id] },
      });

      const updated = parseToolResponse<Task>(updateResult);
      expect(updated.blockedBy).not.toContain(blocker.id);
    });

    it("returns error when adding non-existent blocked_by", async () => {
      const task = await createTask({ name: "Task" });

      const result = await ctx.client.callTool({
        name: "update_task",
        arguments: { id: task.id, add_blocked_by: ["nonexistent123"] },
      });

      expect(isErrorResult(result)).toBe(true);
      const response = parseToolResponse<{ error: string }>(result);
      expect(response.error).toContain("not found");
    });

    it("returns validation error for priority exceeding max", async () => {
      const result = await ctx.client.callTool({
        name: "create_task",
        arguments: {
          name: "Task with invalid priority",
          description: "Context",
          priority: 101,
        },
      });

      expect(isErrorResult(result)).toBe(true);
    });

    it("returns validation error for invalid commit_sha format", async () => {
      const task = await createTask({ name: "Task" });

      const result = await ctx.client.callTool({
        name: "update_task",
        arguments: {
          id: task.id,
          commit_sha: "not-a-valid-sha!",
        },
      });

      expect(isErrorResult(result)).toBe(true);
    });

    it("accepts valid short commit SHA", async () => {
      const task = await createTask({ name: "Task" });

      const result = await ctx.client.callTool({
        name: "update_task",
        arguments: {
          id: task.id,
          commit_sha: "abc1234",
        },
      });

      expect(isErrorResult(result)).toBe(false);
      const updated = parseToolResponse<Task>(result);
      expect(updated.metadata?.commit?.sha).toBe("abc1234");
    });

    it("accepts valid full commit SHA", async () => {
      const task = await createTask({ name: "Task" });

      const result = await ctx.client.callTool({
        name: "update_task",
        arguments: {
          id: task.id,
          commit_sha: "abc123def456789012345678901234567890abcd",
        },
      });

      expect(isErrorResult(result)).toBe(false);
      const updated = parseToolResponse<Task>(result);
      expect(updated.metadata?.commit?.sha).toBe(
        "abc123def456789012345678901234567890abcd",
      );
    });
  });
});
