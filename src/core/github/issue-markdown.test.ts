import { describe, it, expect } from "vitest";
import type { EmbeddedSubtask } from "./issue-markdown.js";
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
} from "./issue-markdown.js";
import type { Task } from "../../types.js";

const DEFAULT_TIMESTAMP = "2024-01-22T10:00:00Z";

function createTestSubtask(
  overrides: Partial<EmbeddedSubtask> = {},
): EmbeddedSubtask {
  return {
    id: "9-1",
    name: "Test subtask",
    description: "",
    priority: 1,
    completed: false,
    result: null,
    metadata: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
    started_at: null,
    completed_at: null,
    blockedBy: [],
    blocks: [],
    children: [],
    ...overrides,
  };
}

function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test",
    parent_id: null,
    name: "Test task",
    description: "",
    priority: 1,
    completed: false,
    result: null,
    metadata: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
    started_at: null,
    completed_at: null,
    blockedBy: [],
    blocks: [],
    children: [],
    ...overrides,
  };
}

describe("parseSubtaskId", () => {
  it("parses valid compound ID", () => {
    expect(parseSubtaskId("9-1")).toEqual({ parentId: "9", localIndex: 1 });
    expect(parseSubtaskId("123-45")).toEqual({
      parentId: "123",
      localIndex: 45,
    });
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

    expect(result.description).toBe(
      "This is the context.\n\nMore details here.",
    );
    expect(result.subtasks).toEqual([]);
  });

  it("parses body with empty subtasks section", () => {
    const body = "Context here.\n\n## Subtasks\n\n";
    const result = parseIssueBody(body);

    expect(result.description).toBe("Context here.");
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

### Description
Subtask context here.

</details>`;

    const result = parseIssueBody(body);

    expect(result.description).toBe("Context here.");
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]).toMatchObject({
      id: "9-1",
      name: "First subtask",
      description: "Subtask context here.",
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

### Description
Task context.

### Result
The task was completed successfully.

</details>`;

    const result = parseIssueBody(body);

    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]).toMatchObject({
      id: "9-2",
      name: "Completed task",
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

### Description
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

### Description
Second context.

### Result
Done.

</details>`;

    const result = parseIssueBody(body);

    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0].id).toBe("9-1");
    expect(result.subtasks[0].name).toBe("First task");
    expect(result.subtasks[1].id).toBe("9-2");
    expect(result.subtasks[1].name).toBe("Second task");
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

### Description
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

### Description
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
    const subtask = createTestSubtask({
      name: "First subtask",
      description: "Subtask context.",
      priority: 5,
    });

    const result = renderIssueBody("Parent context.", [subtask]);

    expect(result).toContain("Parent context.");
    expect(result).toContain("## Subtasks");
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>[ ] First subtask</summary>");
    expect(result).toContain("<!-- dex:subtask:id:9-1 -->");
    expect(result).toContain("<!-- dex:subtask:priority:5 -->");
    expect(result).toContain("<!-- dex:subtask:completed:false -->");
    expect(result).toContain("### Description");
    expect(result).toContain("Subtask context.");
    expect(result).toContain("</details>");
  });

  it("renders completed subtask with checkbox", () => {
    const subtask = createTestSubtask({
      name: "Done task",
      description: "Context.",
      completed: true,
      result: "Completed successfully.",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
    });

    const result = renderIssueBody("Parent context.", [subtask]);

    expect(result).toContain("<summary>[x] Done task</summary>");
    expect(result).toContain("<!-- dex:subtask:completed:true -->");
    expect(result).toContain("### Result");
    expect(result).toContain("Completed successfully.");
  });

  it("renders multiple subtasks", () => {
    const subtasks = [
      createTestSubtask({ id: "9-1", name: "First", description: "Context 1" }),
      createTestSubtask({
        id: "9-2",
        name: "Second",
        description: "Context 2",
        priority: 2,
        completed: true,
        result: "Done",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      }),
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
    const subtask = createTestSubtask({
      name: "Test subtask",
      description: "Test context.",
      priority: 3,
    });

    const rendered = renderIssueBody("Parent context.", [subtask]);
    const parsed = parseIssueBody(rendered);

    expect(parsed.description).toBe("Parent context.");
    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.subtasks[0]).toMatchObject({
      id: "9-1",
      name: "Test subtask",
      description: "Test context.",
      priority: 3,
      completed: false,
    });
  });

  it("round-trips completed subtask with result", () => {
    const subtask = createTestSubtask({
      id: "9-2",
      name: "Completed",
      description: "Context.",
      completed: true,
      result: "All done!",
      updated_at: "2024-01-22T11:00:00Z",
      completed_at: "2024-01-22T11:00:00Z",
    });

    const rendered = renderIssueBody("Parent.", [subtask]);
    const parsed = parseIssueBody(rendered);

    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.subtasks[0].completed).toBe(true);
    expect(parsed.subtasks[0].result).toBe("All done!");
  });
});

describe("embeddedSubtaskToTask", () => {
  it("converts embedded subtask to task", () => {
    const subtask = createTestSubtask({
      name: "Subtask",
      description: "Context",
      priority: 2,
    });

    const task = embeddedSubtaskToTask(subtask, "9");

    expect(task).toEqual({
      id: "9-1",
      parent_id: "9",
      name: "Subtask",
      description: "Context",
      priority: 2,
      completed: false,
      result: null,
      metadata: null,
      created_at: DEFAULT_TIMESTAMP,
      updated_at: DEFAULT_TIMESTAMP,
      started_at: null,
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
    });
  });
});

describe("taskToEmbeddedSubtask", () => {
  it("converts task to embedded subtask", () => {
    const task = createTestTask({
      id: "9-1",
      parent_id: "9",
      name: "Subtask",
      description: "Context",
      priority: 2,
    });

    const subtask = taskToEmbeddedSubtask(task);

    expect(subtask).toEqual({
      id: "9-1",
      name: "Subtask",
      description: "Context",
      priority: 2,
      completed: false,
      result: null,
      metadata: null,
      created_at: DEFAULT_TIMESTAMP,
      updated_at: DEFAULT_TIMESTAMP,
      started_at: null,
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
    const subtasks = [
      createTestSubtask({ id: "9-1", description: "First" }),
      createTestSubtask({ id: "9-3", description: "Third" }),
    ];

    expect(getNextSubtaskIndex(subtasks, "9")).toBe(4);
  });

  it("ignores subtasks from other parents", () => {
    const subtasks = [
      createTestSubtask({ id: "10-5", description: "Other parent" }),
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
    const tasks = [
      createTestTask({
        id: "root",
        name: "Root task",
        description: "Root context",
        children: ["child1", "child2"],
      }),
      createTestTask({
        id: "child1",
        parent_id: "root",
        name: "First child",
        description: "Child 1 context",
        children: ["grandchild1"],
      }),
      createTestTask({
        id: "grandchild1",
        parent_id: "child1",
        name: "Grandchild",
        description: "Grandchild context",
      }),
      createTestTask({
        id: "child2",
        parent_id: "root",
        name: "Second child",
        description: "Child 2 context",
        priority: 2,
        completed: true,
        result: "Done",
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      }),
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root context", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    expect(parsed.description).toBe("Root context");
    expect(parsed.subtasks).toHaveLength(3);

    const child1 = parsed.subtasks.find((s) => s.id === "child1");
    const grandchild1 = parsed.subtasks.find((s) => s.id === "grandchild1");
    const child2 = parsed.subtasks.find((s) => s.id === "child2");

    expect(child1?.parentId).toBe("root");
    expect(grandchild1?.parentId).toBe("child1");
    expect(child2?.parentId).toBe("root");
  });

  it("round-trips subtask with commit metadata", () => {
    const commitMetadata = {
      sha: "abc123def456",
      message: "feat: Add feature",
      branch: "main",
      url: "https://github.com/owner/repo/commit/abc123def456",
      timestamp: "2024-01-22T11:00:00Z",
    };
    const tasks = [
      createTestTask({
        id: "root",
        name: "Root",
        description: "Root context",
        children: ["withcommit"],
      }),
      createTestTask({
        id: "withcommit",
        parent_id: "root",
        name: "Task with commit",
        description: "Commit context",
        completed: true,
        result: "Implemented",
        metadata: { commit: commitMetadata },
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      }),
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root context", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    const subtask = parsed.subtasks.find((s) => s.id === "withcommit");
    expect(subtask?.metadata?.commit).toEqual(commitMetadata);
  });

  it("round-trips subtask with multi-line result", () => {
    const multiLineResult = "Step 1: Done\nStep 2: Done\nStep 3: Done";
    const tasks = [
      createTestTask({
        id: "root",
        name: "Root",
        description: "Root",
        children: ["multiline"],
      }),
      createTestTask({
        id: "multiline",
        parent_id: "root",
        name: "Multi-line result task",
        description: "Context",
        completed: true,
        result: multiLineResult,
        updated_at: "2024-01-22T11:00:00Z",
        completed_at: "2024-01-22T11:00:00Z",
      }),
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root", descendants);
    const parsed = parseHierarchicalIssueBody(rendered);

    const subtask = parsed.subtasks.find((s) => s.id === "multiline");
    expect(subtask?.result).toBe(multiLineResult);
  });

  it("round-trips all timestamp fields", () => {
    const tasks = [
      createTestTask({
        id: "root",
        name: "Root",
        description: "Root",
        children: ["timestamps"],
      }),
      createTestTask({
        id: "timestamps",
        parent_id: "root",
        name: "Timestamp task",
        description: "Context",
        priority: 3,
        completed: true,
        result: "Completed",
        created_at: "2024-01-22T08:00:00Z",
        updated_at: "2024-01-22T12:30:00Z",
        completed_at: "2024-01-22T12:30:00Z",
      }),
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
    const tasks = [
      createTestTask({
        id: "root",
        name: "Root",
        description: "Root",
        children: ["a", "b"],
      }),
      createTestTask({
        id: "a",
        parent_id: "root",
        name: "A",
        description: "A context",
        children: ["a1"],
      }),
      createTestTask({
        id: "a1",
        parent_id: "a",
        name: "A1",
        description: "A1 context",
      }),
      createTestTask({
        id: "b",
        parent_id: "root",
        name: "B",
        description: "B context",
        priority: 2,
      }),
    ];

    const descendants = collectDescendants(tasks, "root");
    const rendered = renderHierarchicalIssueBody("Root", descendants);

    expect(rendered).toContain("- [ ] **A**");
    expect(rendered).toContain("  - [ ] **A1**");
    expect(rendered).toContain("- [ ] **B**");

    const parsed = parseHierarchicalIssueBody(rendered);
    const ids = parsed.subtasks.map((s) => s.id);
    expect(ids).toEqual(["a", "a1", "b"]);
  });
});
