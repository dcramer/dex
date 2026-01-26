import { describe, it, expect } from "vitest";
import {
  parseSubtaskId,
  createSubtaskId,
  parseIssueBody,
  renderIssueBody,
  embeddedSubtaskToTask,
  taskToEmbeddedSubtask,
  getNextSubtaskIndex,
  encodeMetadataValue,
  decodeMetadataValue,
  parseRootTaskMetadata,
  parseHierarchicalIssueBody,
  renderHierarchicalIssueBody,
  collectDescendants,
  EmbeddedSubtask,
} from "./github/index.js";
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
      completed: false,
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
      completed: true,
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
      completed: false,
      result: null,
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
    };

    const result = renderIssueBody("Parent context.", [subtask]);

    expect(result).toContain("Parent context.");
    expect(result).toContain("## Subtasks");
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>[ ] First subtask</summary>");
    expect(result).toContain("<!-- dex:subtask:id:9-1 -->");
    expect(result).toContain("<!-- dex:subtask:priority:5 -->");
    expect(result).toContain("<!-- dex:subtask:completed:false -->");
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
      completed: true,
      result: "Completed successfully.",
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
      blockedBy: [],
      blocks: [],
      children: [],
    };

    const result = renderIssueBody("Parent context.", [subtask]);

    expect(result).toContain("<summary>[x] Done task</summary>");
    expect(result).toContain("<!-- dex:subtask:completed:true -->");
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
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
      },
      {
        id: "9-2",
        description: "Second",
        context: "Context 2",
        priority: 2,
        completed: true,
        result: "Done",
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
        blockedBy: [],
        blocks: [],
        children: [],
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
      completed: false,
      result: null,
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
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
      completed: false,
    });
  });

  it("round-trips completed subtask with result", () => {
    const subtask: EmbeddedSubtask = {
      id: "9-2",
      description: "Completed",
      context: "Context.",
      priority: 1,
      completed: true,
      result: "All done!",
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
      blockedBy: [],
      blocks: [],
      children: [],
    };

    const rendered = renderIssueBody("Parent.", [subtask]);
    const parsed = parseIssueBody(rendered);

    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.subtasks[0].completed).toBe(true);
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
      completed: false,
      result: null,
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
    };

    const task = embeddedSubtaskToTask(subtask, "9");

    expect(task).toEqual({
      id: "9-1",
      parent_id: "9",
      description: "Subtask",
      context: "Context",
      priority: 2,
      completed: false,
      result: null,
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
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
      completed: false,
      result: null,
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
    };

    const subtask = taskToEmbeddedSubtask(task);

    expect(subtask).toEqual({
      id: "9-1",
      description: "Subtask",
      context: "Context",
      priority: 2,
      completed: false,
      result: null,
      metadata: null,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T10:00:00Z",
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
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
        completed: false,
        result: null,
        metadata: null,
        created_at: "",
        updated_at: "",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
      },
      {
        id: "9-3",
        description: "Third",
        context: "",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "",
        updated_at: "",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
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
        completed: false,
        result: null,
        metadata: null,
        created_at: "",
        updated_at: "",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
      },
    ];

    expect(getNextSubtaskIndex(subtasks, "9")).toBe(1);
  });
});

describe("encodeMetadataValue", () => {
  it("returns plain value for simple strings", () => {
    expect(encodeMetadataValue("simple text")).toBe("simple text");
    expect(encodeMetadataValue("another value")).toBe("another value");
  });

  it("base64 encodes strings with newlines", () => {
    const input = "line1\nline2\nline3";
    const encoded = encodeMetadataValue(input);
    expect(encoded).toMatch(/^base64:/);
    expect(encoded).not.toContain("\n");
  });

  it("base64 encodes strings with HTML comment end marker", () => {
    const input = "some --> text";
    const encoded = encodeMetadataValue(input);
    expect(encoded).toMatch(/^base64:/);
    expect(encoded).not.toContain("-->");
  });

  it("base64 encodes strings that start with base64:", () => {
    const input = "base64:pretending to be encoded";
    const encoded = encodeMetadataValue(input);
    expect(encoded).toMatch(/^base64:/);
    // Should be double-encoded
    const decoded = decodeMetadataValue(encoded);
    expect(decoded).toBe(input);
  });
});

describe("decodeMetadataValue", () => {
  it("returns plain value for non-encoded strings", () => {
    expect(decodeMetadataValue("simple text")).toBe("simple text");
    expect(decodeMetadataValue("another value")).toBe("another value");
  });

  it("decodes base64 encoded strings", () => {
    const original = "line1\nline2\nline3";
    const encoded = encodeMetadataValue(original);
    expect(decodeMetadataValue(encoded)).toBe(original);
  });

  it("round-trips complex strings", () => {
    const testCases = [
      "simple",
      "with\nnewlines\neverywhere",
      "contains --> html comment end",
      "base64:fake encoded",
      "mixed\ncontent --> with\neverything",
    ];

    for (const original of testCases) {
      const encoded = encodeMetadataValue(original);
      const decoded = decodeMetadataValue(encoded);
      expect(decoded).toBe(original);
    }
  });
});

describe("parseRootTaskMetadata", () => {
  it("returns null for body without dex metadata", () => {
    const body = "Just some regular content\n\nNo metadata here.";
    expect(parseRootTaskMetadata(body)).toBeNull();
  });

  it("parses legacy format with just task ID", () => {
    const body = "<!-- dex:task:abc123 -->\n\nSome content here.";
    const metadata = parseRootTaskMetadata(body);
    expect(metadata).toEqual({ id: "abc123" });
  });

  it("parses new format with full metadata", () => {
    const body = `<!-- dex:task:id:abc123 -->
<!-- dex:task:priority:2 -->
<!-- dex:task:completed:true -->
<!-- dex:task:created_at:2024-01-22T10:00:00Z -->
<!-- dex:task:updated_at:2024-01-22T11:00:00Z -->
<!-- dex:task:completed_at:2024-01-22T11:00:00Z -->

Some context here.`;

    const metadata = parseRootTaskMetadata(body);
    expect(metadata).toEqual({
      id: "abc123",
      priority: 2,
      completed: true,
      created_at: "2024-01-22T10:00:00Z",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
    });
  });

  it("parses metadata with null completed_at", () => {
    const body = `<!-- dex:task:id:abc123 -->
<!-- dex:task:completed:false -->
<!-- dex:task:completed_at:null -->

Content here.`;

    const metadata = parseRootTaskMetadata(body);
    expect(metadata?.completed).toBe(false);
    expect(metadata?.completed_at).toBeNull();
  });

  it("parses metadata with base64-encoded result", () => {
    const result = "Line 1\nLine 2\nLine 3";
    const encodedResult = encodeMetadataValue(result);
    const body = `<!-- dex:task:id:abc123 -->
<!-- dex:task:result:${encodedResult} -->

Content here.`;

    const metadata = parseRootTaskMetadata(body);
    expect(metadata?.result).toBe(result);
  });

  it("parses metadata with commit info", () => {
    const body = `<!-- dex:task:id:abc123 -->
<!-- dex:task:commit_sha:abcdef1234567890 -->
<!-- dex:task:commit_message:Fix bug -->
<!-- dex:task:commit_branch:main -->
<!-- dex:task:commit_url:https://github.com/owner/repo/commit/abcdef -->
<!-- dex:task:commit_timestamp:2024-01-22T11:00:00Z -->

Content here.`;

    const metadata = parseRootTaskMetadata(body);
    expect(metadata?.commit).toEqual({
      sha: "abcdef1234567890",
      message: "Fix bug",
      branch: "main",
      url: "https://github.com/owner/repo/commit/abcdef",
      timestamp: "2024-01-22T11:00:00Z",
    });
  });

  it("parses commit with base64-encoded multi-line message", () => {
    const message = "First line\n\nSecond paragraph\n- bullet 1\n- bullet 2";
    const encodedMessage = encodeMetadataValue(message);
    const body = `<!-- dex:task:id:abc123 -->
<!-- dex:task:commit_sha:abcdef1234567890 -->
<!-- dex:task:commit_message:${encodedMessage} -->

Content here.`;

    const metadata = parseRootTaskMetadata(body);
    expect(metadata?.commit?.message).toBe(message);
  });

  it("ignores commit metadata without sha", () => {
    const body = `<!-- dex:task:id:abc123 -->
<!-- dex:task:commit_message:No sha here -->
<!-- dex:task:commit_branch:main -->

Content here.`;

    const metadata = parseRootTaskMetadata(body);
    expect(metadata?.commit).toBeUndefined();
  });
});

describe("hierarchical issue body round-trip", () => {
  it("round-trips nested subtasks with parent relationships", () => {
    const tasks: Task[] = [
      {
        id: "root",
        parent_id: null,
        description: "Root task",
        context: "Root context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["child1", "child2"],
      },
      {
        id: "child1",
        parent_id: "root",
        description: "First child",
        context: "Child 1 context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["grandchild1"],
      },
      {
        id: "grandchild1",
        parent_id: "child1",
        description: "Grandchild",
        context: "Grandchild context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
      },
      {
        id: "child2",
        parent_id: "root",
        description: "Second child",
        context: "Child 2 context",
        priority: 2,
        completed: true,
        result: "Done",
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
        blockedBy: [],
        blocks: [],
        children: [],
      },
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root context", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    expect(parsed.context).toBe("Root context");
    expect(parsed.subtasks).toHaveLength(3);

    // Check parent relationships preserved
    const child1 = parsed.subtasks.find((s) => s.id === "child1");
    const grandchild1 = parsed.subtasks.find((s) => s.id === "grandchild1");
    const child2 = parsed.subtasks.find((s) => s.id === "child2");

    expect(child1?.parentId).toBe("root");
    expect(grandchild1?.parentId).toBe("child1");
    expect(child2?.parentId).toBe("root");
  });

  it("round-trips subtask with commit metadata", () => {
    const tasks: Task[] = [
      {
        id: "root",
        parent_id: null,
        description: "Root",
        context: "Root context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["withcommit"],
      },
      {
        id: "withcommit",
        parent_id: "root",
        description: "Task with commit",
        context: "Commit context",
        priority: 1,
        completed: true,
        result: "Implemented",
        metadata: {
          commit: {
            sha: "abc123def456",
            message: "feat: Add feature",
            branch: "main",
            url: "https://github.com/owner/repo/commit/abc123def456",
            timestamp: "2024-01-22T11:00:00Z",
          },
        },
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
        blockedBy: [],
        blocks: [],
        children: [],
      },
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root context", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    const subtask = parsed.subtasks.find((s) => s.id === "withcommit");
    expect(subtask?.metadata?.commit).toEqual({
      sha: "abc123def456",
      message: "feat: Add feature",
      branch: "main",
      url: "https://github.com/owner/repo/commit/abc123def456",
      timestamp: "2024-01-22T11:00:00Z",
    });
  });

  it("round-trips subtask with multi-line result", () => {
    const multiLineResult = "Step 1: Done\nStep 2: Done\nStep 3: Done";
    const tasks: Task[] = [
      {
        id: "root",
        parent_id: null,
        description: "Root",
        context: "Root",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["multiline"],
      },
      {
        id: "multiline",
        parent_id: "root",
        description: "Multi-line result task",
        context: "Context",
        priority: 1,
        completed: true,
        result: multiLineResult,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
        blockedBy: [],
        blocks: [],
        children: [],
      },
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    const subtask = parsed.subtasks.find((s) => s.id === "multiline");
    expect(subtask?.result).toBe(multiLineResult);
  });

  it("round-trips all timestamp fields", () => {
    const tasks: Task[] = [
      {
        id: "root",
        parent_id: null,
        description: "Root",
        context: "Root",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["timestamps"],
      },
      {
        id: "timestamps",
        parent_id: "root",
        description: "Timestamp task",
        context: "Context",
        priority: 3,
        completed: true,
        result: "Completed",
        metadata: null,
        created_at: "2024-01-22T08:00:00Z",
        updated_at: "2024-01-22T12:30:00Z",
        completed_at: "2024-01-22T12:30:00Z",
        blockedBy: [],
        blocks: [],
        children: [],
      },
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    const subtask = parsed.subtasks.find((s) => s.id === "timestamps");
    expect(subtask?.created_at).toBe("2024-01-22T08:00:00Z");
    expect(subtask?.updated_at).toBe("2024-01-22T12:30:00Z");
    expect(subtask?.completed_at).toBe("2024-01-22T12:30:00Z");
    expect(subtask?.priority).toBe(3);
    expect(subtask?.completed).toBe(true);
  });

  it("preserves depth ordering in rendered output", () => {
    const tasks: Task[] = [
      {
        id: "root",
        parent_id: null,
        description: "Root",
        context: "Root",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["a", "b"],
      },
      {
        id: "a",
        parent_id: "root",
        description: "A",
        context: "A context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: ["a1"],
      },
      {
        id: "a1",
        parent_id: "a",
        description: "A1",
        context: "A1 context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
      },
      {
        id: "b",
        parent_id: "root",
        description: "B",
        context: "B context",
        priority: 2,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-22T10:00:00Z",
        updated_at: "2024-01-22T10:00:00Z",
        completed_at: null,
        blockedBy: [],
        blocks: [],
        children: [],
      },
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root", descendants);

    // Verify Task Tree section has proper indentation
    expect(rendered).toContain("- [ ] **A**");
    expect(rendered).toContain("  - [ ] **A1**");
    expect(rendered).toContain("- [ ] **B**");

    // Verify depth-first order is preserved
    const parsed = parseHierarchicalIssueBody(rendered);
    const ids = parsed.subtasks.map((s) => s.id);
    expect(ids).toEqual(["a", "a1", "b"]);
  });
});
