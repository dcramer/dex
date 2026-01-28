import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compactTask,
  collectArchivableTasks,
  canAutoArchive,
  findAutoArchivableTasks,
  DEFAULT_AUTO_ARCHIVE_CONFIG,
} from "./archive-compactor.js";
import type { Task } from "../types.js";

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: "test-id",
  parent_id: null,
  name: "Test task",
  description: "Some description",
  priority: 1,
  completed: false,
  result: null,
  metadata: null,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  started_at: null,
  completed_at: null,
  blockedBy: [],
  blocks: [],
  children: [],
  ...overrides,
});

describe("compactTask", () => {
  it("strips unnecessary fields", () => {
    const task = createTask({
      id: "task-1",
      name: "My task",
      description: "Lots of description here",
      priority: 5,
      completed: true,
      result: "Done successfully",
      completed_at: "2024-01-15T10:00:00.000Z",
      blockedBy: ["other-1"],
      blocks: ["other-2"],
      children: ["child-1"],
    });

    const archived = compactTask(task);

    // Preserved fields
    expect(archived.id).toBe("task-1");
    expect(archived.parent_id).toBeNull();
    expect(archived.name).toBe("My task");
    expect(archived.description).toBe("Lots of description here");
    expect(archived.result).toBe("Done successfully");
    expect(archived.completed_at).toBe("2024-01-15T10:00:00.000Z");
    expect(archived.archived_at).toBeDefined();
    expect(archived.archived_children).toEqual([]);

    // Stripped fields should not exist
    expect("priority" in archived).toBe(false);
    expect("blockedBy" in archived).toBe(false);
    expect("blocks" in archived).toBe(false);
    expect("children" in archived).toBe(false);
    expect("created_at" in archived).toBe(false);
    expect("updated_at" in archived).toBe(false);
  });

  it("rolls up children into archived_children", () => {
    const task = createTask({
      id: "parent",
      completed: true,
      result: "Parent done",
    });
    const children = [
      createTask({ id: "child-1", name: "First child", result: "Done" }),
      createTask({
        id: "child-2",
        name: "Second child",
        result: null,
      }),
    ];

    const archived = compactTask(task, children);

    expect(archived.archived_children).toHaveLength(2);
    expect(archived.archived_children[0]).toEqual({
      id: "child-1",
      name: "First child",
      description: "Some description",
      result: "Done",
    });
    expect(archived.archived_children[1]).toEqual({
      id: "child-2",
      name: "Second child",
      description: "Some description",
      result: null,
    });
  });

  it("preserves GitHub metadata", () => {
    const task = createTask({
      metadata: {
        github: {
          issueNumber: 42,
          issueUrl: "https://github.com/test/test/issues/42",
          repo: "test/test",
        },
      },
    });

    const archived = compactTask(task);

    expect(archived.metadata?.github).toEqual({
      issueNumber: 42,
      issueUrl: "https://github.com/test/test/issues/42",
      repo: "test/test",
    });
  });

  it("preserves commit metadata", () => {
    const task = createTask({
      metadata: {
        commit: {
          sha: "abc123",
          message: "Fix bug",
          branch: "main",
        },
      },
    });

    const archived = compactTask(task);

    expect(archived.metadata?.commit).toEqual({
      sha: "abc123",
      message: "Fix bug",
      branch: "main",
    });
  });

  it("preserves both github and commit metadata", () => {
    const task = createTask({
      metadata: {
        github: {
          issueNumber: 42,
          issueUrl: "https://github.com/test/test/issues/42",
          repo: "test/test",
        },
        commit: {
          sha: "abc123",
        },
      },
    });

    const archived = compactTask(task);

    expect(archived.metadata?.github).toBeDefined();
    expect(archived.metadata?.commit).toBeDefined();
  });

  it("sets metadata to null when no relevant metadata exists", () => {
    const task = createTask({ metadata: null });

    const archived = compactTask(task);

    expect(archived.metadata).toBeNull();
  });

  it("adds archived_at timestamp", () => {
    const before = new Date().toISOString();
    const task = createTask();

    const archived = compactTask(task);

    const after = new Date().toISOString();
    expect(archived.archived_at >= before).toBe(true);
    expect(archived.archived_at <= after).toBe(true);
  });
});

describe("collectArchivableTasks", () => {
  it("returns null for non-existent task", () => {
    const tasks = [createTask({ id: "other" })];

    const result = collectArchivableTasks("missing", tasks);

    expect(result).toBeNull();
  });

  it("returns null for incomplete task", () => {
    const task = createTask({ id: "incomplete", completed: false });

    const result = collectArchivableTasks("incomplete", [task]);

    expect(result).toBeNull();
  });

  it("returns task and empty descendants for leaf task", () => {
    const task = createTask({ id: "leaf", completed: true });

    const result = collectArchivableTasks("leaf", [task]);

    expect(result).not.toBeNull();
    expect(result!.root.id).toBe("leaf");
    expect(result!.descendants).toEqual([]);
  });

  it("returns null when child is incomplete", () => {
    const parent = createTask({
      id: "parent",
      completed: true,
      children: ["child"],
    });
    const child = createTask({
      id: "child",
      parent_id: "parent",
      completed: false,
    });

    const result = collectArchivableTasks("parent", [parent, child]);

    expect(result).toBeNull();
  });

  it("collects all completed descendants", () => {
    const parent = createTask({
      id: "parent",
      completed: true,
      children: ["child"],
    });
    const child = createTask({
      id: "child",
      parent_id: "parent",
      completed: true,
      children: ["grandchild"],
    });
    const grandchild = createTask({
      id: "grandchild",
      parent_id: "child",
      completed: true,
    });

    const result = collectArchivableTasks("parent", [
      parent,
      child,
      grandchild,
    ]);

    expect(result).not.toBeNull();
    expect(result!.root.id).toBe("parent");
    expect(result!.descendants).toHaveLength(2);
    expect(result!.descendants.map((t) => t.id)).toContain("child");
    expect(result!.descendants.map((t) => t.id)).toContain("grandchild");
  });

  it("returns null when ancestor is incomplete", () => {
    const grandparent = createTask({
      id: "grandparent",
      completed: false, // Active ancestor
      children: ["parent"],
    });
    const parent = createTask({
      id: "parent",
      parent_id: "grandparent",
      completed: true,
      children: ["child"],
    });
    const child = createTask({
      id: "child",
      parent_id: "parent",
      completed: true,
    });

    const result = collectArchivableTasks("parent", [
      grandparent,
      parent,
      child,
    ]);

    expect(result).toBeNull();
  });

  it("allows archiving when all ancestors are completed", () => {
    const grandparent = createTask({
      id: "grandparent",
      completed: true,
      children: ["parent"],
    });
    const parent = createTask({
      id: "parent",
      parent_id: "grandparent",
      completed: true,
    });

    const result = collectArchivableTasks("parent", [grandparent, parent]);

    expect(result).not.toBeNull();
  });
});

describe("canAutoArchive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false for incomplete task", () => {
    const task = createTask({ completed: false });

    expect(canAutoArchive(task, [task])).toBe(false);
  });

  it("returns false when completed_at is missing", () => {
    const task = createTask({ completed: true, completed_at: null });

    expect(canAutoArchive(task, [task])).toBe(false);
  });

  it("returns false when task is too recent", () => {
    vi.setSystemTime(new Date("2024-02-01"));
    const task = createTask({
      completed: true,
      completed_at: "2024-01-15T00:00:00.000Z", // 17 days ago
    });

    expect(
      canAutoArchive(task, [task], { minAgeDays: 30, keepRecentCount: 0 }),
    ).toBe(false);
  });

  it("returns true when task is old enough", () => {
    vi.setSystemTime(new Date("2024-06-01"));
    const task = createTask({
      id: "old",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z", // ~150 days ago
    });

    expect(
      canAutoArchive(task, [task], { minAgeDays: 90, keepRecentCount: 0 }),
    ).toBe(true);
  });

  it("returns false when task is in recent completed list", () => {
    vi.setSystemTime(new Date("2024-06-01"));
    const oldTask = createTask({
      id: "old",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
    });

    // Even though it's old enough, it's the only completed task so it's "recent"
    expect(
      canAutoArchive(oldTask, [oldTask], {
        minAgeDays: 90,
        keepRecentCount: 50,
      }),
    ).toBe(false);
  });

  it("returns true when task is outside recent window", () => {
    vi.setSystemTime(new Date("2024-06-01"));

    // Create 3 completed tasks
    const oldTask = createTask({
      id: "old",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
    });
    const recent1 = createTask({
      id: "recent1",
      completed: true,
      completed_at: "2024-05-01T00:00:00.000Z",
    });
    const recent2 = createTask({
      id: "recent2",
      completed: true,
      completed_at: "2024-05-15T00:00:00.000Z",
    });

    // Keep only 2 recent, so oldTask should be archivable
    expect(
      canAutoArchive(oldTask, [oldTask, recent1, recent2], {
        minAgeDays: 90,
        keepRecentCount: 2,
      }),
    ).toBe(true);
  });

  it("returns false when descendants are incomplete", () => {
    vi.setSystemTime(new Date("2024-06-01"));
    const parent = createTask({
      id: "parent",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
      children: ["child"],
    });
    const child = createTask({
      id: "child",
      parent_id: "parent",
      completed: false,
    });

    expect(
      canAutoArchive(parent, [parent, child], {
        minAgeDays: 90,
        keepRecentCount: 0,
      }),
    ).toBe(false);
  });

  it("uses default config when not provided", () => {
    vi.setSystemTime(new Date("2024-06-01"));
    const task = createTask({
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
    });

    // Default is 90 days and 50 recent - task is old but also in recent 50
    expect(canAutoArchive(task, [task])).toBe(false);
  });
});

describe("findAutoArchivableTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty array when no tasks are archivable", () => {
    const task = createTask({ completed: false });

    const result = findAutoArchivableTasks([task]);

    expect(result).toEqual([]);
  });

  it("skips tasks with parents", () => {
    const parent = createTask({
      id: "parent",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
      children: ["child"],
    });
    const child = createTask({
      id: "child",
      parent_id: "parent",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
    });

    // Only parent should be returned, child will be archived with parent
    const result = findAutoArchivableTasks([parent, child], {
      minAgeDays: 90,
      keepRecentCount: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("parent");
  });

  it("finds multiple archivable root tasks", () => {
    const task1 = createTask({
      id: "task1",
      completed: true,
      completed_at: "2024-01-01T00:00:00.000Z",
    });
    const task2 = createTask({
      id: "task2",
      completed: true,
      completed_at: "2024-01-02T00:00:00.000Z",
    });

    const result = findAutoArchivableTasks([task1, task2], {
      minAgeDays: 90,
      keepRecentCount: 0,
    });

    expect(result).toHaveLength(2);
  });
});

describe("DEFAULT_AUTO_ARCHIVE_CONFIG", () => {
  it("has expected defaults", () => {
    expect(DEFAULT_AUTO_ARCHIVE_CONFIG.minAgeDays).toBe(90);
    expect(DEFAULT_AUTO_ARCHIVE_CONFIG.keepRecentCount).toBe(50);
  });
});
