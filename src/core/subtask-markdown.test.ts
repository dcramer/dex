import { describe, it, expect } from "vitest";
import {
  parseSubtaskId,
  createSubtaskId,
  parseIssueBody,
  renderIssueBody,
  embeddedSubtaskToTask,
  taskToEmbeddedSubtask,
  getNextSubtaskIndex,
  EmbeddedSubtask,
} from "./subtask-markdown.js";
import { Task } from "../types.js";

describe("parseSubtaskId", () => {
  it("parses valid compound ID", () => {
    expect(parseSubtaskId("9-1")).toEqual({ parentId: "9", localIndex: 1 });
    expect(parseSubtaskId("123-45")).toEqual({ parentId: "123", localIndex: 45 });
  });

  it("returns null for non-compound IDs", () => {
    expect(parseSubtaskId("9")).toBeNull();
    expect(parseSubtaskId("abc")).toBeNull();
    expect(parseSubtaskId("9-a")).toBeNull();
    expect(parseSubtaskId("a-1")).toBeNull();
    expect(parseSubtaskId("")).toBeNull();
  });
});

describe("createSubtaskId", () => {
  it("creates compound ID", () => {
    expect(createSubtaskId("9", 1)).toBe("9-1");
    expect(createSubtaskId("123", 45)).toBe("123-45");
  });
});

describe("parseIssueBody", () => {
  it("parses body without subtasks", () => {
    const body = "This is the context.\n\nMore details here.";
    const result = parseIssueBody(body);

    expect(result.context).toBe("This is the context.\n\nMore details here.");
    expect(result.subtasks).toEqual([]);
  });

  it("parses body with empty subtasks section", () => {
    const body = "Context here.\n\n## Subtasks\n\n";
    const result = parseIssueBody(body);

    expect(result.context).toBe("Context here.");
    expect(result.subtasks).toEqual([]);
  });

  it("parses body with one subtask", () => {
    const body = `Context here.

## Subtasks

<details>
<summary>[ ] First subtask</summary>
<!-- dex:subtask:id:9-1 -->
<!-- dex:subtask:priority:5 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:completed_at:null -->

### Context
Subtask context here.

</details>`;

    const result = parseIssueBody(body);

    expect(result.context).toBe("Context here.");
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]).toMatchObject({
      id: "9-1",
      description: "First subtask",
      context: "Subtask context here.",
      priority: 5,
      status: "pending",
      result: null,
    });
  });

  it("parses completed subtask with result", () => {
    const body = `Context here.

## Subtasks

<details>
<summary>[x] Completed task</summary>
<!-- dex:subtask:id:9-2 -->
<!-- dex:subtask:priority:3 -->
<!-- dex:subtask:status:completed -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T12:00:00Z -->
<!-- dex:subtask:completed_at:2024-01-22T12:00:00Z -->

### Context
Task context.

### Result
The task was completed successfully.

</details>`;

    const result = parseIssueBody(body);

    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]).toMatchObject({
      id: "9-2",
      description: "Completed task",
      status: "completed",
      result: "The task was completed successfully.",
    });
  });

  it("parses multiple subtasks", () => {
    const body = `Context here.

## Subtasks

<details>
<summary>[ ] First task</summary>
<!-- dex:subtask:id:9-1 -->
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:completed_at:null -->

### Context
First context.

</details>

<details>
<summary>[x] Second task</summary>
<!-- dex:subtask:id:9-2 -->
<!-- dex:subtask:priority:2 -->
<!-- dex:subtask:status:completed -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->
<!-- dex:subtask:updated_at:2024-01-22T11:00:00Z -->
<!-- dex:subtask:completed_at:2024-01-22T11:00:00Z -->

### Context
Second context.

### Result
Done.

</details>`;

    const result = parseIssueBody(body);

    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0].id).toBe("9-1");
    expect(result.subtasks[0].description).toBe("First task");
    expect(result.subtasks[1].id).toBe("9-2");
    expect(result.subtasks[1].description).toBe("Second task");
  });

  it("handles malformed details block gracefully", () => {
    const body = `Context here.

## Subtasks

<details>
<summary>Missing checkbox</summary>
Some content without proper format
</details>

<details>
<summary>[ ] Valid task</summary>
<!-- dex:subtask:id:9-1 -->
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->

### Context
Valid context.

</details>`;

    const result = parseIssueBody(body);

    // Should only parse the valid subtask, skip malformed one
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].id).toBe("9-1");
  });

  it("skips details block without ID", () => {
    const body = `Context here.

## Subtasks

<details>
<summary>[ ] Task without ID</summary>
<!-- dex:subtask:priority:1 -->
<!-- dex:subtask:status:pending -->

### Context
No ID here.

</details>`;

    const result = parseIssueBody(body);
    expect(result.subtasks).toHaveLength(0);
  });
});

describe("renderIssueBody", () => {
  it("renders body without subtasks", () => {
    const result = renderIssueBody("Context here.", []);
    expect(result).toBe("Context here.");
  });

  it("renders body with one subtask", () => {
    const subtask: EmbeddedSubtask = {
      id: "9-1",
      description: "First subtask",
      context: "Subtask context.",
      priority: 5,
      status: "pending",
      result: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
    };

    const result = renderIssueBody("Parent context.", [subtask]);

    expect(result).toContain("Parent context.");
    expect(result).toContain("## Subtasks");
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>[ ] First subtask</summary>");
    expect(result).toContain("<!-- dex:subtask:id:9-1 -->");
    expect(result).toContain("<!-- dex:subtask:priority:5 -->");
    expect(result).toContain("<!-- dex:subtask:status:pending -->");
    expect(result).toContain("### Context");
    expect(result).toContain("Subtask context.");
    expect(result).toContain("</details>");
  });

  it("renders completed subtask with checkbox", () => {
    const subtask: EmbeddedSubtask = {
      id: "9-1",
      description: "Done task",
      context: "Context.",
      priority: 1,
      status: "completed",
      result: "Completed successfully.",
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
    };

    const result = renderIssueBody("Parent context.", [subtask]);

    expect(result).toContain("<summary>[x] Done task</summary>");
    expect(result).toContain("<!-- dex:subtask:status:completed -->");
    expect(result).toContain("### Result");
    expect(result).toContain("Completed successfully.");
  });

  it("renders multiple subtasks", () => {
    const subtasks: EmbeddedSubtask[] = [
      {
        id: "9-1",
        description: "First",
        context: "Context 1",
        priority: 1,
        status: "pending",
        result: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
      },
      {
        id: "9-2",
        description: "Second",
        context: "Context 2",
        priority: 2,
        status: "completed",
        result: "Done",
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      },
    ];

    const result = renderIssueBody("Parent.", subtasks);

    expect(result).toContain("<!-- dex:subtask:id:9-1 -->");
    expect(result).toContain("<!-- dex:subtask:id:9-2 -->");
    expect(result).toContain("<summary>[ ] First</summary>");
    expect(result).toContain("<summary>[x] Second</summary>");
  });
});

describe("round-trip parsing/rendering", () => {
  it("round-trips body with subtasks", () => {
    const subtask: EmbeddedSubtask = {
      id: "9-1",
      description: "Test subtask",
      context: "Test context.",
      priority: 3,
      status: "pending",
      result: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
    };

    const rendered = renderIssueBody("Parent context.", [subtask]);
    const parsed = parseIssueBody(rendered);

    expect(parsed.context).toBe("Parent context.");
    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.subtasks[0]).toMatchObject({
      id: "9-1",
      description: "Test subtask",
      context: "Test context.",
      priority: 3,
      status: "pending",
    });
  });

  it("round-trips completed subtask with result", () => {
    const subtask: EmbeddedSubtask = {
      id: "9-2",
      description: "Completed",
      context: "Context.",
      priority: 1,
      status: "completed",
      result: "All done!",
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
    };

    const rendered = renderIssueBody("Parent.", [subtask]);
    const parsed = parseIssueBody(rendered);

    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.subtasks[0].status).toBe("completed");
    expect(parsed.subtasks[0].result).toBe("All done!");
  });
});

describe("embeddedSubtaskToTask", () => {
  it("converts embedded subtask to task", () => {
    const subtask: EmbeddedSubtask = {
      id: "9-1",
      description: "Subtask",
      context: "Context",
      priority: 2,
      status: "pending",
      result: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
    };

    const task = embeddedSubtaskToTask(subtask, "9");

    expect(task).toEqual({
      id: "9-1",
      parent_id: "9",
      description: "Subtask",
      context: "Context",
      priority: 2,
      status: "pending",
      result: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
    });
  });
});

describe("taskToEmbeddedSubtask", () => {
  it("converts task to embedded subtask", () => {
    const task: Task = {
      id: "9-1",
      parent_id: "9",
      description: "Subtask",
      context: "Context",
      priority: 2,
      status: "pending",
      result: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
    };

    const subtask = taskToEmbeddedSubtask(task);

    expect(subtask).toEqual({
      id: "9-1",
      description: "Subtask",
      context: "Context",
      priority: 2,
      status: "pending",
      result: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
    });
  });
});

describe("getNextSubtaskIndex", () => {
  it("returns 1 for empty subtasks", () => {
    expect(getNextSubtaskIndex([], "9")).toBe(1);
  });

  it("returns next index after existing subtasks", () => {
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

    expect(getNextSubtaskIndex(subtasks, "9")).toBe(4);
  });

  it("ignores subtasks from other parents", () => {
    const subtasks: EmbeddedSubtask[] = [
      {
        id: "10-5",
        description: "Other parent",
        context: "",
        priority: 1,
        status: "pending",
        result: null,
        created_at: "",
        updated_at: "",
        completed_at: null,
      },
    ];

    expect(getNextSubtaskIndex(subtasks, "9")).toBe(1);
  });
});
