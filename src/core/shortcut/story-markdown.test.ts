import { describe, it, expect } from "vitest";
import {
  encodeMetadataValue,
  decodeMetadataValue,
  parseTaskMetadata,
  parseStoryDescription,
  renderStoryDescription,
} from "./story-markdown.js";
import type { Task } from "../../types.js";

const DEFAULT_TIMESTAMP = "2024-01-22T10:00:00Z";

function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc12345",
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

describe("encodeMetadataValue", () => {
  it("returns simple strings unchanged", () => {
    for (const value of ["hello", "simple value", "123", ""]) {
      expect(encodeMetadataValue(value)).toBe(value);
    }
  });

  it("encodes strings with newlines", () => {
    const encoded = encodeMetadataValue("line1\nline2");
    expect(encoded).toMatch(/^base64:/);
    expect(encoded).not.toContain("\n");
  });

  it("encodes strings with HTML comment close sequence", () => {
    const encoded = encodeMetadataValue("contains --> comment close");
    expect(encoded).toMatch(/^base64:/);
    expect(encoded).not.toContain("-->");
  });

  it("encodes strings starting with base64:", () => {
    const value = "base64:not actually encoded";
    const encoded = encodeMetadataValue(value);
    expect(encoded).toMatch(/^base64:/);
    expect(decodeMetadataValue(encoded)).toBe(value);
  });

  it("encodes multi-line commit messages", () => {
    const encoded = encodeMetadataValue(
      "feat: Add new feature\n\nThis is the body.\n\n- Item 1\n- Item 2",
    );
    expect(encoded).toMatch(/^base64:/);
  });
});

describe("decodeMetadataValue", () => {
  it("round-trips all value types correctly", () => {
    const testCases = [
      "simple",
      "simple value",
      "with\nnewlines",
      "contains --> comment close",
      "base64:fake prefix",
      "emoji: 🎉 test",
      "unicode: 日本語",
      "",
    ];

    for (const value of testCases) {
      const encoded = encodeMetadataValue(value);
      expect(decodeMetadataValue(encoded)).toBe(value);
    }
  });
});

describe("parseTaskMetadata", () => {
  it("returns null for description without dex metadata", () => {
    for (const input of [
      "Just some text",
      "",
      "<!-- not-dex:something:value -->",
    ]) {
      expect(parseTaskMetadata(input)).toBeNull();
    }
  });

  it("parses basic task metadata", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:priority:2 -->
<!-- dex:task:completed:false -->
<!-- dex:task:created_at:2024-01-22T10:00:00Z -->
<!-- dex:task:updated_at:2024-01-22T11:00:00Z -->
<!-- dex:task:completed_at:null -->

Task description here.`;

    const result = parseTaskMetadata(description);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("abc12345");
    expect(result!.priority).toBe(2);
    expect(result!.completed).toBe(false);
    expect(result!.created_at).toBe("2024-01-22T10:00:00Z");
    expect(result!.updated_at).toBe("2024-01-22T11:00:00Z");
    expect(result!.completed_at).toBeNull();
  });

  it("parses completed task metadata", () => {
    const description = `<!-- dex:task:id:xyz98765 -->
<!-- dex:task:completed:true -->
<!-- dex:task:completed_at:2024-01-23T15:00:00Z -->`;

    const result = parseTaskMetadata(description);
    expect(result!.completed).toBe(true);
    expect(result!.completed_at).toBe("2024-01-23T15:00:00Z");
  });

  it("parses task with parent_id", () => {
    const description = `<!-- dex:task:id:child123 -->
<!-- dex:task:parent_id:parent456 -->`;

    const result = parseTaskMetadata(description);
    expect(result!.id).toBe("child123");
    expect(result!.parent_id).toBe("parent456");
  });

  it("parses task with result", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:result:Task completed successfully -->`;

    const result = parseTaskMetadata(description);
    expect(result!.result).toBe("Task completed successfully");
  });

  it("parses task with base64-encoded result", () => {
    const multiLineResult = "Line 1\nLine 2\nLine 3";
    const encoded = encodeMetadataValue(multiLineResult);
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:result:${encoded} -->`;

    const result = parseTaskMetadata(description);
    expect(result!.result).toBe(multiLineResult);
  });

  it("parses commit metadata", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:commit_sha:abc123def456 -->
<!-- dex:task:commit_message:feat: Add feature -->
<!-- dex:task:commit_branch:main -->
<!-- dex:task:commit_url:https://github.com/owner/repo/commit/abc123 -->
<!-- dex:task:commit_timestamp:2024-01-22T12:00:00Z -->`;

    const result = parseTaskMetadata(description);
    expect(result!.commit).not.toBeUndefined();
    expect(result!.commit!.sha).toBe("abc123def456");
    expect(result!.commit!.message).toBe("feat: Add feature");
    expect(result!.commit!.branch).toBe("main");
    expect(result!.commit!.url).toBe(
      "https://github.com/owner/repo/commit/abc123",
    );
    expect(result!.commit!.timestamp).toBe("2024-01-22T12:00:00Z");
  });

  it("parses commit with multi-line message", () => {
    const commitMessage = "feat: Add feature\n\nDetailed description here.";
    const encoded = encodeMetadataValue(commitMessage);
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:commit_sha:abc123 -->
<!-- dex:task:commit_message:${encoded} -->`;

    const result = parseTaskMetadata(description);
    expect(result!.commit!.message).toBe(commitMessage);
  });

  it("does not include commit if no SHA present", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:commit_message:orphan message -->`;

    const result = parseTaskMetadata(description);
    expect(result!.commit).toBeUndefined();
  });

  it("handles mixed content with metadata scattered throughout", () => {
    const description = `Some intro text.

<!-- dex:task:id:abc12345 -->

Middle content.

<!-- dex:task:priority:3 -->

More text.

<!-- dex:task:completed:true -->`;

    const result = parseTaskMetadata(description);
    expect(result!.id).toBe("abc12345");
    expect(result!.priority).toBe(3);
    expect(result!.completed).toBe(true);
  });
});

describe("parseStoryDescription", () => {
  it("extracts clean context without metadata comments", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:priority:1 -->

Task description here.

More details.`;

    const result = parseStoryDescription(description);
    expect(result.context).toBe("Task description here.\n\nMore details.");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata!.id).toBe("abc12345");
  });

  it("returns empty context for metadata-only description", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- dex:task:priority:1 -->`;

    const result = parseStoryDescription(description);
    expect(result.context).toBe("");
  });

  it("preserves non-dex comments in context", () => {
    const description = `<!-- dex:task:id:abc12345 -->
<!-- Regular HTML comment -->
Task content.`;

    const result = parseStoryDescription(description);
    expect(result.context).toContain("<!-- Regular HTML comment -->");
    expect(result.context).toContain("Task content.");
  });

  it("handles description without any metadata", () => {
    const description = "Just plain text content.";
    const result = parseStoryDescription(description);
    expect(result.context).toBe("Just plain text content.");
    expect(result.metadata).toBeNull();
  });
});

describe("renderStoryDescription", () => {
  it("renders basic task with required fields", () => {
    const task = createTestTask();
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:id:abc12345 -->");
    expect(result).toContain("<!-- dex:task:priority:1 -->");
    expect(result).toContain("<!-- dex:task:completed:false -->");
    expect(result).toContain(
      `<!-- dex:task:created_at:${DEFAULT_TIMESTAMP} -->`,
    );
    expect(result).toContain(
      `<!-- dex:task:updated_at:${DEFAULT_TIMESTAMP} -->`,
    );
    expect(result).toContain("<!-- dex:task:completed_at:null -->");
  });

  it("includes parent_id when present", () => {
    const task = createTestTask({ parent_id: "parent123" });
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:parent_id:parent123 -->");
  });

  it("does not include parent_id when null", () => {
    const task = createTestTask({ parent_id: null });
    const result = renderStoryDescription(task);

    expect(result).not.toContain("dex:task:parent_id");
  });

  it("includes description after metadata", () => {
    const task = createTestTask({ description: "Task description here." });
    const result = renderStoryDescription(task);

    // Metadata should come first
    const idPos = result.indexOf("dex:task:id");
    const descPos = result.indexOf("Task description here.");
    expect(idPos).toBeLessThan(descPos);
    expect(result).toContain("\n\nTask description here.");
  });

  it("renders completed task with completed_at", () => {
    const task = createTestTask({
      completed: true,
      completed_at: "2024-01-23T15:00:00Z",
    });
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:completed:true -->");
    expect(result).toContain(
      "<!-- dex:task:completed_at:2024-01-23T15:00:00Z -->",
    );
  });

  it("renders result when present", () => {
    const task = createTestTask({ result: "Task completed successfully" });
    const result = renderStoryDescription(task);

    expect(result).toContain(
      "<!-- dex:task:result:Task completed successfully -->",
    );
  });

  it("encodes multi-line result", () => {
    const multiLineResult = "Line 1\nLine 2";
    const task = createTestTask({ result: multiLineResult });
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:result:base64:");
    // Verify it can be decoded
    const match = result.match(/<!-- dex:task:result:(.*?) -->/);
    expect(match).not.toBeNull();
    expect(decodeMetadataValue(match![1])).toBe(multiLineResult);
  });

  it("does not include result when null", () => {
    const task = createTestTask({ result: null });
    const result = renderStoryDescription(task);

    expect(result).not.toContain("dex:task:result");
  });

  it("renders commit metadata when present", () => {
    const task = createTestTask({
      metadata: {
        commit: {
          sha: "abc123def456",
          message: "feat: Add feature",
          branch: "main",
          url: "https://github.com/owner/repo/commit/abc123",
          timestamp: "2024-01-22T12:00:00Z",
        },
      },
    });
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:commit_sha:abc123def456 -->");
    expect(result).toContain(
      "<!-- dex:task:commit_message:feat: Add feature -->",
    );
    expect(result).toContain("<!-- dex:task:commit_branch:main -->");
    expect(result).toContain(
      "<!-- dex:task:commit_url:https://github.com/owner/repo/commit/abc123 -->",
    );
    expect(result).toContain(
      "<!-- dex:task:commit_timestamp:2024-01-22T12:00:00Z -->",
    );
  });

  it("encodes multi-line commit message", () => {
    const commitMessage = "feat: Add feature\n\nDetailed body.";
    const task = createTestTask({
      metadata: {
        commit: {
          sha: "abc123",
          message: commitMessage,
        },
      },
    });
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:commit_message:base64:");
  });

  it("handles commit with only sha", () => {
    const task = createTestTask({
      metadata: {
        commit: {
          sha: "abc123",
        },
      },
    });
    const result = renderStoryDescription(task);

    expect(result).toContain("<!-- dex:task:commit_sha:abc123 -->");
    expect(result).not.toContain("commit_message");
    expect(result).not.toContain("commit_branch");
  });

  it("round-trips through parse and render", () => {
    const originalTask = createTestTask({
      id: "roundtrip",
      parent_id: "parent123",
      priority: 2,
      completed: true,
      completed_at: "2024-01-23T15:00:00Z",
      description: "Task description",
      result: "Completed with result\nMulti-line",
      metadata: {
        commit: {
          sha: "abc123",
          message: "fix: Bug fix\n\nDetails here.",
          branch: "main",
          url: "https://github.com/owner/repo/commit/abc123",
          timestamp: "2024-01-22T12:00:00Z",
        },
      },
    });

    const rendered = renderStoryDescription(originalTask);
    const parsed = parseTaskMetadata(rendered);

    expect(parsed!.id).toBe(originalTask.id);
    expect(parsed!.parent_id).toBe(originalTask.parent_id);
    expect(parsed!.priority).toBe(originalTask.priority);
    expect(parsed!.completed).toBe(originalTask.completed);
    expect(parsed!.completed_at).toBe(originalTask.completed_at);
    expect(parsed!.result).toBe(originalTask.result);
    expect(parsed!.commit!.sha).toBe(originalTask.metadata!.commit!.sha);
    expect(parsed!.commit!.message).toBe(
      originalTask.metadata!.commit!.message,
    );
    expect(parsed!.commit!.branch).toBe(originalTask.metadata!.commit!.branch);
  });
});
