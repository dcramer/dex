import { describe, it, expect } from "vitest";
import {
  parseSubtaskId,
  createSubtaskId,
  parseIssueBody,
  renderIssueBody,
  taskToEmbeddedSubtask,
  embeddedSubtaskToTask,
  getNextSubtaskIndex,
  EmbeddedSubtask,
} from "./subtask-markdown.js";
import { Task } from "../types.js";

describe("subtask-markdown", () => {
  describe("parseSubtaskId", () => {
    it("parses valid compound ID", () => {
      expect(parseSubtaskId("9-1")).toEqual({ parentId: "9", localIndex: 1 });
      expect(parseSubtaskId("123-45")).toEqual({ parentId: "123", localIndex: 45 });
    });

    it("returns null for non-compound IDs", () => {
      expect(parseSubtaskId("9")).toBeNull();
      expect(parseSubtaskId("abc-1")).toBeNull();
      expect(parseSubtaskId("9-abc")).toBeNull();
      expect(parseSubtaskId("")).toBeNull();
      expect(parseSubtaskId("9-1-2")).toBeNull();
    });
  });

  describe("createSubtaskId", () => {
    it("creates compound ID from parent ID and index", () => {
      expect(createSubtaskId("9", 1)).toBe("9-1");
      expect(createSubtaskId("123", 45)).toBe("123-45");
    });
  });

  describe("parseIssueBody", () => {
    it("handles null body", () => {
      const result = parseIssueBody(null);
      expect(result.context).toBe("");
      expect(result.subtasks).toEqual([]);
    });

    it("handles empty body", () => {
      const result = parseIssueBody("");
      expect(result.context).toBe("");
      expect(result.subtasks).toEqual([]);
    });

    it("handles body without subtasks section", () => {
      const body = "Parent task context here.\n\nMore details.";
      const result = parseIssueBody(body);
      expect(result.context).toBe("Parent task context here.\n\nMore details.");
      expect(result.subtasks).toEqual([]);
    });

    it("parses body with subtasks section", () => {
      const body = `Parent task context here.

## Subtasks

<details>
<summary>[ ] First subtask</summary>
<!-- dex:subtask:id:9-1 -->
<!-- dex:subtask:priority:5 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->

### Context
Subtask context here.

</details>

<details>
<summary>[x] Completed subtask</summary>
<!-- dex:subtask:id:9-2 -->
<!-- dex:subtask:priority:3 -->
<!-- dex:subtask:status:completed -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T11:00:00Z -->
<!-- dex:subtask:completed_at:2024-01-22T11:00:00Z -->

### Context
Completed subtask context.

### Result
The result of this subtask.

</details>`;

      const result = parseIssueBody(body);
      expect(result.context).toBe("Parent task context here.");
      expect(result.subtasks).toHaveLength(2);

      expect(result.subtasks[0]).toMatchObject({
        id: "9-1",
        description: "First subtask",
        context: "Subtask context here.",
        priority: 5,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
      });

      expect(result.subtasks[1]).toMatchObject({
        id: "9-2",
        description: "Completed subtask",
        context: "Completed subtask context.",
        priority: 3,
        status: "completed",
        result: "The result of this subtask.",
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      });
    });

    it("handles malformed subtasks gracefully", () => {
      const body = `Context here.

## Subtasks

Some random text that's not a details block.

<details>
<summary>[ ] Valid subtask</summary>
<!-- dex:subtask:id:9-1 -->
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->

### Context
Valid context.

</details>`;

      const result = parseIssueBody(body);
      expect(result.context).toBe("Context here.");
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].description).toBe("Valid subtask");
    });

    it("handles subtasks without all metadata", () => {
      const body = `Context.

## Subtasks

<details>
<summary>[ ] Minimal subtask</summary>

### Context
Just context, no metadata.

</details>`;

      const result = parseIssueBody(body);
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].description).toBe("Minimal subtask");
      expect(result.subtasks[0].context).toBe("Just context, no metadata.");
      expect(result.subtasks[0].priority).toBe(1); // Default
      expect(result.subtasks[0].status).toBe("pending"); // Derived from checkbox
    });
  });

  describe("renderIssueBody", () => {
    it("renders body without subtasks", () => {
      const result = renderIssueBody("Parent context.", []);
      expect(result).toBe("Parent context.");
    });

    it("renders body with subtasks", () => {
      const subtasks: EmbeddedSubtask[] = [
        {
          id: "9-1",
          description: "First subtask",
          context: "First context",
          priority: 5,
          status: "pending",
          result: null,
          created_at: "2024-01-22T10:00:00Z",
          updated_at: "2024-01-22T10:00:00Z",
          completed_at: null,
        },
        {
          id: "9-2",
          description: "Completed subtask",
          context: "Second context",
          priority: 3,
          status: "completed",
          result: "Done!",
          created_at: "2024-01-22T10:00:00Z",
          updated_at: "2024-01-22T11:00:00Z",
          completed_at: "2024-01-22T11:00:00Z",
        },
      ];

      const result = renderIssueBody("Parent context.", subtasks);

      expect(result).toContain("Parent context.");
      expect(result).toContain("## Subtasks");
      expect(result).toContain("<summary>[ ] First subtask</summary>");
      expect(result).toContain("<summary>[x] Completed subtask</summary>");
      expect(result).toContain("<!-- dex:subtask:id:9-1 -->");
      expect(result).toContain("<!-- dex:subtask:id:9-2 -->");
      expect(result).toContain("### Context\nFirst context");
      expect(result).toContain("### Result\nDone!");
    });
  });

  describe("round-trip parsing and rendering", () => {
    it("preserves data through parse-render cycle", () => {
      const originalSubtasks: EmbeddedSubtask[] = [
        {
          id: "9-1",
          description: "Test subtask",
          context: "Test context",
          priority: 3,
          status: "pending",
          result: null,
          created_at: "2024-01-22T10:00:00Z",
          updated_at: "2024-01-22T10:00:00Z",
          completed_at: null,
        },
      ];

      const rendered = renderIssueBody("Original context", originalSubtasks);
      const parsed = parseIssueBody(rendered);

      expect(parsed.context).toBe("Original context");
      expect(parsed.subtasks).toHaveLength(1);
      expect(parsed.subtasks[0]).toMatchObject({
        id: "9-1",
        description: "Test subtask",
        context: "Test context",
        priority: 3,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
      });
    });
  });

  describe("taskToEmbeddedSubtask", () => {
    it("converts Task to EmbeddedSubtask", () => {
      const task: Task = {
        id: "9-1",
        parent_id: "9",
        description: "Test task",
        context: "Test context",
        priority: 5,
        status: "completed",
        result: "Done",
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      };

      const result = taskToEmbeddedSubtask(task);

      expect(result).toEqual({
        id: "9-1",
        description: "Test task",
        context: "Test context",
        priority: 5,
        status: "completed",
        result: "Done",
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      });
    });
  });

  describe("embeddedSubtaskToTask", () => {
    it("converts EmbeddedSubtask to Task with parent_id", () => {
      const subtask: EmbeddedSubtask = {
        id: "9-1",
        description: "Test subtask",
        context: "Test context",
        priority: 5,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      };

      const result = embeddedSubtaskToTask(subtask, "9");

      expect(result).toEqual({
        id: "9-1",
        parent_id: "9",
        description: "Test subtask",
        context: "Test context",
        priority: 5,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      });
    });
  });

  describe("getNextSubtaskIndex", () => {
    it("returns 1 for empty array", () => {
      expect(getNextSubtaskIndex([])).toBe(1);
    });

    it("returns max index + 1", () => {
      const subtasks: EmbeddedSubtask[] = [
        {
          id: "9-1",
          description: "First",
          context: "",
          priority: 1,
          status: "pending",
          result: null,
          created_at: "",
          updated_at: "",
          completed_at: null,
        },
        {
          id: "9-3",
          description: "Third",
          context: "",
          priority: 1,
          status: "pending",
          result: null,
          created_at: "",
          updated_at: "",
          completed_at: null,
        },
      ];

      expect(getNextSubtaskIndex(subtasks)).toBe(4);
    });

    it("handles subtasks with invalid IDs", () => {
      const subtasks: EmbeddedSubtask[] = [
        {
          id: "invalid",
          description: "Invalid",
          context: "",
          priority: 1,
          status: "pending",
          result: null,
          created_at: "",
          updated_at: "",
          completed_at: null,
        },
      ];

      expect(getNextSubtaskIndex(subtasks)).toBe(1);
    });
  });
});
