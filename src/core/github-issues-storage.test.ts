import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { GitHubIssuesStorage } from "./github-issues-storage.js";
import { Task, TaskStore } from "../types.js";

// Create mock functions for Octokit methods
const mockListForRepo = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGet = vi.fn();
const mockCreateComment = vi.fn();

// Mock Octokit module
vi.mock("@octokit/rest", () => ({
  Octokit: function () {
    return {
      issues: {
        listForRepo: mockListForRepo,
        create: mockCreate,
        update: mockUpdate,
        get: mockGet,
        createComment: mockCreateComment,
      },
    };
  },
}));

describe("GitHubIssuesStorage", () => {
  let storage: GitHubIssuesStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new GitHubIssuesStorage({
      owner: "test-owner",
      repo: "test-repo",
      token: "test-token",
    });
  });

  describe("read()", () => {
    it("throws error because sync read is not supported", () => {
      expect(() => storage.read()).toThrow(
        "GitHubIssuesStorage requires async operations"
      );
    });
  });

  describe("write()", () => {
    it("throws error because sync write is not supported", () => {
      const store: TaskStore = { tasks: [] };
      expect(() => storage.write(store)).toThrow(
        "GitHubIssuesStorage requires async operations"
      );
    });
  });

  describe("isSync()", () => {
    it("returns false", () => {
      expect(storage.isSync()).toBe(false);
    });
  });

  describe("getIdentifier()", () => {
    it("returns owner/repo", () => {
      expect(storage.getIdentifier()).toBe("test-owner/test-repo");
    });
  });

  describe("readAsync()", () => {
    it("reads parent task without subtasks", async () => {
      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "Parent task",
            body: "Parent context",
            state: "open",
            labels: [{ name: "dex" }, { name: "dex:priority-3" }],
            created_at: "2024-01-22T10:00:00Z",
            updated_at: "2024-01-22T10:00:00Z",
            closed_at: null,
          },
        ],
      });

      const store = await storage.readAsync();

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0]).toMatchObject({
        id: "1",
        parent_id: null,
        description: "Parent task",
        context: "Parent context",
        priority: 3,
        status: "pending",
      });
    });

    it("reads parent task with embedded subtasks", async () => {
      const bodyWithSubtasks = `Parent context here.

## Subtasks

<details>
<summary>[ ] First subtask</summary>
<!-- dex:subtask:id:1-1 -->
<!-- dex:subtask:priority:5 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->

### Context
Subtask context.

</details>

<details>
<summary>[x] Completed subtask</summary>
<!-- dex:subtask:id:1-2 -->
<!-- dex:subtask:priority:3 -->
<!-- dex:subtask:status:completed -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T11:00:00Z -->
<!-- dex:subtask:completed_at:2024-01-22T11:00:00Z -->

### Context
Done subtask context.

### Result
The result.

</details>`;

      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "Parent task",
            body: bodyWithSubtasks,
            state: "open",
            labels: [{ name: "dex" }, { name: "dex:priority-1" }],
            created_at: "2024-01-22T10:00:00Z",
            updated_at: "2024-01-22T10:00:00Z",
            closed_at: null,
          },
        ],
      });

      const store = await storage.readAsync();

      expect(store.tasks).toHaveLength(3);

      // Parent task
      expect(store.tasks[0]).toMatchObject({
        id: "1",
        parent_id: null,
        description: "Parent task",
        context: "Parent context here.",
        priority: 1,
        status: "pending",
      });

      // First subtask
      expect(store.tasks[1]).toMatchObject({
        id: "1-1",
        parent_id: "1",
        description: "First subtask",
        context: "Subtask context.",
        priority: 5,
        status: "pending",
      });

      // Completed subtask
      expect(store.tasks[2]).toMatchObject({
        id: "1-2",
        parent_id: "1",
        description: "Completed subtask",
        context: "Done subtask context.",
        priority: 3,
        status: "completed",
        result: "The result.",
      });
    });

    it("skips pull requests", async () => {
      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "PR title",
            body: "PR body",
            state: "open",
            labels: [{ name: "dex" }],
            pull_request: { url: "https://api.github.com/..." },
            created_at: "2024-01-22T10:00:00Z",
            updated_at: "2024-01-22T10:00:00Z",
            closed_at: null,
          },
        ],
      });

      const store = await storage.readAsync();

      expect(store.tasks).toHaveLength(0);
    });

    it("reads closed issues as completed tasks", async () => {
      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "Completed task",
            body: "Done",
            state: "closed",
            labels: [{ name: "dex" }, { name: "dex:priority-2" }],
            created_at: "2024-01-22T10:00:00Z",
            updated_at: "2024-01-22T11:00:00Z",
            closed_at: "2024-01-22T11:00:00Z",
          },
        ],
      });

      const store = await storage.readAsync();

      expect(store.tasks[0]).toMatchObject({
        id: "1",
        status: "completed",
        completed_at: "2024-01-22T11:00:00Z",
      });
    });

    it("throws StorageError on API failure", async () => {
      mockListForRepo.mockRejectedValue(new Error("API error"));

      await expect(storage.readAsync()).rejects.toThrow(
        "Failed to read from GitHub Issues"
      );
    });
  });

  describe("writeAsync()", () => {
    it("creates new parent task without subtasks", async () => {
      mockListForRepo.mockResolvedValue({ data: [] });
      mockCreate.mockResolvedValue({
        data: { number: 1 },
      });

      const task: Task = {
        id: "temp-id",
        parent_id: null,
        description: "New task",
        context: "New context",
        priority: 3,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      await storage.writeAsync({ tasks: [task] });

      expect(mockCreate).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        title: "New task",
        body: "New context",
        labels: ["dex", "dex:priority-3", "dex:pending"],
      });
    });

    it("creates parent task with subtasks embedded", async () => {
      mockListForRepo.mockResolvedValue({ data: [] });
      mockCreate.mockResolvedValue({
        data: { number: 5 },
      });
      mockUpdate.mockResolvedValue({ data: {} });

      const parentTask: Task = {
        id: "temp-parent",
        parent_id: null,
        description: "Parent task",
        context: "Parent context",
        priority: 1,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      const subtask: Task = {
        id: "temp-sub",
        parent_id: "temp-parent",
        description: "Subtask",
        context: "Subtask context",
        priority: 5,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      await storage.writeAsync({ tasks: [parentTask, subtask] });

      // First creates the issue
      expect(mockCreate).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        title: "Parent task",
        body: "Parent context",
        labels: ["dex", "dex:priority-1", "dex:pending"],
      });

      // Then updates it with embedded subtasks
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-owner",
          repo: "test-repo",
          issue_number: 5,
          body: expect.stringContaining("## Subtasks"),
        })
      );

      // Verify subtask is embedded in the body
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.body).toContain("Subtask");
      expect(updateCall.body).toContain("<!-- dex:subtask:id:5-1 -->");
    });

    it("updates existing issue with subtasks", async () => {
      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "Existing task",
            body: "Old context",
            state: "open",
            labels: [{ name: "dex" }],
          },
        ],
      });
      mockGet.mockResolvedValue({
        data: {
          number: 1,
          body: "Old context",
        },
      });
      mockUpdate.mockResolvedValue({ data: {} });

      const parentTask: Task = {
        id: "1",
        parent_id: null,
        description: "Updated task",
        context: "Updated context",
        priority: 2,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: null,
      };

      const subtask: Task = {
        id: "1-1",
        parent_id: "1",
        description: "New subtask",
        context: "Subtask context",
        priority: 3,
        status: "pending",
        result: null,
        created_at: "2024-01-22T11:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: null,
      };

      await storage.writeAsync({ tasks: [parentTask, subtask] });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-owner",
          repo: "test-repo",
          issue_number: 1,
          title: "Updated task",
          body: expect.stringContaining("## Subtasks"),
          labels: ["dex", "dex:priority-2", "dex:pending"],
          state: "open",
        })
      );

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.body).toContain("<!-- dex:subtask:id:1-1 -->");
      expect(updateCall.body).toContain("New subtask");
    });

    it("creates completed parent task with closed state", async () => {
      mockListForRepo.mockResolvedValue({ data: [] });
      mockCreate.mockResolvedValue({
        data: { number: 1 },
      });
      mockUpdate.mockResolvedValue({ data: {} });

      const task: Task = {
        id: "temp-id",
        parent_id: null,
        description: "Completed task",
        context: "Context",
        priority: 1,
        status: "completed",
        result: "Task result",
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      };

      await storage.writeAsync({ tasks: [task] });

      // Should create with completed label
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ["dex", "dex:priority-1", "dex:completed"],
        })
      );

      // Should add result as comment
      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        body: "## Result\n\nTask result",
      });

      // Should close the issue
      expect(mockUpdate).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        state: "closed",
      });
    });

    it("warns about orphaned subtasks", async () => {
      mockListForRepo.mockResolvedValue({ data: [] });

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const orphanedSubtask: Task = {
        id: "orphan-1",
        parent_id: "nonexistent-parent",
        description: "Orphan",
        context: "Orphan context",
        priority: 1,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      await storage.writeAsync({ tasks: [orphanedSubtask] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('orphaned subtask')
      );

      consoleWarnSpy.mockRestore();
    });

    it("throws StorageError on API failure", async () => {
      mockListForRepo.mockRejectedValue(new Error("API error"));

      await expect(
        storage.writeAsync({ tasks: [] })
      ).rejects.toThrow("Failed to write to GitHub Issues");
    });

    it("handles subtask status update (checkbox change)", async () => {
      const existingBody = `Parent context.

## Subtasks

<details>
<summary>[ ] Pending subtask</summary>
<!-- dex:subtask:id:1-1 -->
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->

### Context
Subtask context.

</details>`;

      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "Parent",
            body: existingBody,
            state: "open",
            labels: [{ name: "dex" }],
          },
        ],
      });
      mockGet.mockResolvedValue({
        data: { number: 1, body: existingBody },
      });
      mockUpdate.mockResolvedValue({ data: {} });

      const parentTask: Task = {
        id: "1",
        parent_id: null,
        description: "Parent",
        context: "Parent context.",
        priority: 1,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      const completedSubtask: Task = {
        id: "1-1",
        parent_id: "1",
        description: "Pending subtask",
        context: "Subtask context.",
        priority: 1,
        status: "completed",
        result: "Subtask done!",
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      };

      await storage.writeAsync({ tasks: [parentTask, completedSubtask] });

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.body).toContain("[x]");
      expect(updateCall.body).toContain("<!-- dex:subtask:status:completed -->");
      expect(updateCall.body).toContain("### Result");
      expect(updateCall.body).toContain("Subtask done!");
    });

    it("removes subtask when not included in write", async () => {
      const existingBody = `Parent context.

## Subtasks

<details>
<summary>[ ] Subtask to remove</summary>
<!-- dex:subtask:id:1-1 -->
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->

### Context
This will be removed.

</details>`;

      mockListForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: "Parent",
            body: existingBody,
            state: "open",
            labels: [{ name: "dex" }],
          },
        ],
      });
      mockGet.mockResolvedValue({
        data: { number: 1, body: existingBody },
      });
      mockUpdate.mockResolvedValue({ data: {} });

      // Only pass the parent, no subtasks
      const parentTask: Task = {
        id: "1",
        parent_id: null,
        description: "Parent",
        context: "Parent context.",
        priority: 1,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      await storage.writeAsync({ tasks: [parentTask] });

      const updateCall = mockUpdate.mock.calls[0][0];
      // Body should not contain subtasks section when no subtasks provided
      expect(updateCall.body).not.toContain("## Subtasks");
      expect(updateCall.body).not.toContain("Subtask to remove");
    });
  });
});
