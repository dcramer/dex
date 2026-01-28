import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { performAutoArchive, DEFAULT_ARCHIVE_CONFIG } from "./auto-archive.js";
import type { Task, TaskStore } from "../types.js";
import { ArchiveStorage } from "./storage/archive-storage.js";

// Mock fs module for log file operations
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    appendFileSync: vi.fn(),
  };
});

// Mock git-utils for commit checking
vi.mock("./git-utils.js", () => ({
  isCommitOnRemote: vi.fn(() => true), // Default: commits are on remote
}));

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

describe("DEFAULT_ARCHIVE_CONFIG", () => {
  it("has auto-archive disabled by default", () => {
    expect(DEFAULT_ARCHIVE_CONFIG.auto).toBe(false);
  });

  it("has expected default values", () => {
    expect(DEFAULT_ARCHIVE_CONFIG.age_days).toBe(90);
    expect(DEFAULT_ARCHIVE_CONFIG.keep_recent).toBe(50);
  });
});

describe("performAutoArchive", () => {
  const testStoragePath = "/tmp/dex-test-auto-archive";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01"));

    // Clean up any existing test files
    try {
      fs.rmSync(testStoragePath, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
    fs.mkdirSync(testStoragePath, { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    // Clean up test files
    try {
      fs.rmSync(testStoragePath, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  it("does nothing when auto-archive is disabled (default)", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "old-task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath);

    expect(result.archivedCount).toBe(0);
    expect(result.archivedIds).toEqual([]);
    expect(store.tasks).toHaveLength(1);
  });

  it("does nothing when auto-archive is explicitly disabled", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "old-task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, { auto: false });

    expect(result.archivedCount).toBe(0);
    expect(store.tasks).toHaveLength(1);
  });

  it("archives eligible tasks when auto-archive is enabled", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "old-task",
          name: "Old completed task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    expect(result.archivedCount).toBe(1);
    expect(result.archivedIds).toContain("old-task");
    expect(store.tasks).toHaveLength(0);
  });

  it("does not archive tasks that are too recent", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "recent-task",
          completed: true,
          completed_at: "2024-05-15T00:00:00.000Z", // Only ~17 days ago
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    expect(result.archivedCount).toBe(0);
    expect(store.tasks).toHaveLength(1);
  });

  it("does not archive tasks in the keep_recent window", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "old-task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    // Keep recent 50, and this is the only completed task
    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 50,
    });

    expect(result.archivedCount).toBe(0);
    expect(store.tasks).toHaveLength(1);
  });

  it("archives task and all descendants together", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "parent",
          name: "Parent task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
          children: ["child"],
        }),
        createTask({
          id: "child",
          name: "Child task",
          parent_id: "parent",
          completed: true,
          completed_at: "2024-01-02T00:00:00.000Z",
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    expect(result.archivedCount).toBe(1); // Only counts root tasks
    expect(result.archivedIds).toContain("parent");
    expect(store.tasks).toHaveLength(0);

    // Verify archive file contains both tasks
    const archiveStorage = new ArchiveStorage({ path: testStoragePath });
    const archived = archiveStorage.readArchive();
    expect(archived.tasks).toHaveLength(2);
    expect(archived.tasks.map((t) => t.id)).toContain("parent");
    expect(archived.tasks.map((t) => t.id)).toContain("child");
  });

  it("does not archive tasks with incomplete descendants", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "parent",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
          children: ["child"],
        }),
        createTask({
          id: "child",
          parent_id: "parent",
          completed: false, // Incomplete
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    expect(result.archivedCount).toBe(0);
    expect(store.tasks).toHaveLength(2);
  });

  it("only archives root-level tasks", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "parent",
          completed: false, // Active parent
          children: ["child"],
        }),
        createTask({
          id: "child",
          parent_id: "parent",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    // Child should not be archived because its parent is still active
    expect(result.archivedCount).toBe(0);
    expect(store.tasks).toHaveLength(2);
  });

  it("cleans up blocking references when archiving", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "archived-task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
          blocks: ["remaining-task"],
        }),
        createTask({
          id: "remaining-task",
          completed: false,
          blockedBy: ["archived-task"],
        }),
      ],
    };

    performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    // Remaining task should have its blockedBy cleaned up
    const remainingTask = store.tasks.find((t) => t.id === "remaining-task");
    expect(remainingTask).toBeDefined();
    expect(remainingTask!.blockedBy).not.toContain("archived-task");
  });

  it("logs archive events to archive.log", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "old-task",
          name: "My old task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 0,
    });

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      path.join(testStoragePath, "archive.log"),
      expect.stringContaining("AUTO-ARCHIVED old-task: My old task"),
      "utf-8",
    );
  });

  it("archives multiple eligible tasks", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "task1",
          name: "First task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
        createTask({
          id: "task2",
          name: "Second task",
          completed: true,
          completed_at: "2024-01-02T00:00:00.000Z",
        }),
        createTask({
          id: "recent-task",
          name: "Recent task",
          completed: true,
          completed_at: "2024-05-20T00:00:00.000Z",
        }),
      ],
    };

    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
      age_days: 90,
      keep_recent: 1, // Keep only the most recent
    });

    expect(result.archivedCount).toBe(2);
    expect(result.archivedIds).toContain("task1");
    expect(result.archivedIds).toContain("task2");
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].id).toBe("recent-task");
  });

  it("uses default config values when not all options are specified", () => {
    const store: TaskStore = {
      tasks: [
        createTask({
          id: "old-task",
          completed: true,
          completed_at: "2024-01-01T00:00:00.000Z",
        }),
      ],
    };

    // Only enable auto, use defaults for age_days and keep_recent
    const result = performAutoArchive(store, testStoragePath, {
      auto: true,
    });

    // With default keep_recent of 50, this task won't be archived
    expect(result.archivedCount).toBe(0);
  });

  describe("commit-based archive filtering", () => {
    it("does not archive tasks with unpushed commits", async () => {
      const { isCommitOnRemote } = await import("./git-utils.js");
      vi.mocked(isCommitOnRemote).mockReturnValue(false); // Commit not pushed

      const store: TaskStore = {
        tasks: [
          createTask({
            id: "unpushed-task",
            completed: true,
            completed_at: "2024-01-01T00:00:00.000Z",
            metadata: {
              commit: {
                sha: "abc123",
                message: "Fix bug",
              },
            },
          }),
        ],
      };

      const result = performAutoArchive(store, testStoragePath, {
        auto: true,
        age_days: 90,
        keep_recent: 0,
      });

      expect(result.archivedCount).toBe(0);
      expect(store.tasks).toHaveLength(1);
    });

    it("archives tasks with pushed commits", async () => {
      const { isCommitOnRemote } = await import("./git-utils.js");
      vi.mocked(isCommitOnRemote).mockReturnValue(true); // Commit is pushed

      const store: TaskStore = {
        tasks: [
          createTask({
            id: "pushed-task",
            completed: true,
            completed_at: "2024-01-01T00:00:00.000Z",
            metadata: {
              commit: {
                sha: "abc123",
                message: "Fix bug",
              },
            },
          }),
        ],
      };

      const result = performAutoArchive(store, testStoragePath, {
        auto: true,
        age_days: 90,
        keep_recent: 0,
      });

      expect(result.archivedCount).toBe(1);
      expect(store.tasks).toHaveLength(0);
    });

    it("archives tasks without commit metadata (uses local status)", async () => {
      const { isCommitOnRemote } = await import("./git-utils.js");
      vi.mocked(isCommitOnRemote).mockReturnValue(true); // No commit = assume pushed

      const store: TaskStore = {
        tasks: [
          createTask({
            id: "no-commit-task",
            completed: true,
            completed_at: "2024-01-01T00:00:00.000Z",
            // No commit metadata
          }),
        ],
      };

      const result = performAutoArchive(store, testStoragePath, {
        auto: true,
        age_days: 90,
        keep_recent: 0,
      });

      expect(result.archivedCount).toBe(1);
      expect(store.tasks).toHaveLength(0);
    });
  });
});
