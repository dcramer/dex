import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ArchiveStorage } from "./archive-storage.js";
import { ArchivedTask } from "../../types.js";

describe("ArchiveStorage", () => {
  let tempDir: string;
  let storage: ArchiveStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-test-"));
    storage = new ArchiveStorage(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createArchivedTask = (
    overrides: Partial<ArchivedTask> = {},
  ): ArchivedTask => ({
    id: "test-id",
    parent_id: null,
    name: "Test task",
    result: null,
    completed_at: null,
    archived_at: new Date().toISOString(),
    metadata: null,
    archived_children: [],
    ...overrides,
  });

  describe("readArchive", () => {
    it("returns empty store when file does not exist", () => {
      const store = storage.readArchive();
      expect(store.tasks).toEqual([]);
    });

    it("returns empty store when file is empty", () => {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "archive.jsonl"), "");

      const store = storage.readArchive();
      expect(store.tasks).toEqual([]);
    });

    it("parses valid JSONL file", () => {
      const task1 = createArchivedTask({ id: "task-1", name: "First" });
      const task2 = createArchivedTask({ id: "task-2", name: "Second" });

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "archive.jsonl"),
        JSON.stringify(task1) + "\n" + JSON.stringify(task2) + "\n",
      );

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0].id).toBe("task-1");
      expect(store.tasks[1].id).toBe("task-2");
    });

    it("sorts tasks by ID", () => {
      const task1 = createArchivedTask({ id: "z-last" });
      const task2 = createArchivedTask({ id: "a-first" });

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "archive.jsonl"),
        JSON.stringify(task1) + "\n" + JSON.stringify(task2) + "\n",
      );

      const store = storage.readArchive();
      expect(store.tasks[0].id).toBe("a-first");
      expect(store.tasks[1].id).toBe("z-last");
    });

    it("throws on invalid JSON", () => {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "archive.jsonl"), "not valid json\n");

      expect(() => storage.readArchive()).toThrow(/Invalid JSON on line 1/);
    });

    it("throws on invalid schema", () => {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "archive.jsonl"),
        '{"id":"test"}\n', // missing required fields
      );

      expect(() => storage.readArchive()).toThrow(/Invalid schema on line 1/);
    });

    it("handles tasks with archived_children", () => {
      const task = createArchivedTask({
        id: "parent",
        archived_children: [
          { id: "child-1", name: "Child 1", result: "Done" },
          { id: "child-2", name: "Child 2", result: null },
        ],
      });

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "archive.jsonl"),
        JSON.stringify(task) + "\n",
      );

      const store = storage.readArchive();
      expect(store.tasks[0].archived_children).toHaveLength(2);
      expect(store.tasks[0].archived_children[0].name).toBe("Child 1");
    });
  });

  describe("writeArchive", () => {
    it("creates directory if not exists", () => {
      const nestedPath = path.join(tempDir, "nested", "deep");
      const nestedStorage = new ArchiveStorage(nestedPath);

      nestedStorage.writeArchive({ tasks: [] });

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it("writes tasks in JSONL format", () => {
      const task = createArchivedTask({ id: "test-task" });

      storage.writeArchive({ tasks: [task] });

      const content = fs.readFileSync(
        path.join(tempDir, "archive.jsonl"),
        "utf-8",
      );
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).id).toBe("test-task");
    });

    it("sorts tasks by ID when writing", () => {
      const task1 = createArchivedTask({ id: "z-last" });
      const task2 = createArchivedTask({ id: "a-first" });

      storage.writeArchive({ tasks: [task1, task2] });

      const content = fs.readFileSync(
        path.join(tempDir, "archive.jsonl"),
        "utf-8",
      );
      const lines = content.trim().split("\n");
      expect(JSON.parse(lines[0]).id).toBe("a-first");
      expect(JSON.parse(lines[1]).id).toBe("z-last");
    });

    it("handles empty task list", () => {
      storage.writeArchive({ tasks: [] });

      const content = fs.readFileSync(
        path.join(tempDir, "archive.jsonl"),
        "utf-8",
      );
      expect(content).toBe("");
    });
  });

  describe("appendArchive", () => {
    it("creates file if not exists", () => {
      const task = createArchivedTask({ id: "new-task" });

      storage.appendArchive([task]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
    });

    it("appends to existing archive", () => {
      const existing = createArchivedTask({ id: "existing" });
      storage.writeArchive({ tasks: [existing] });

      const newTask = createArchivedTask({ id: "new" });
      storage.appendArchive([newTask]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(2);
    });

    it("does nothing when appending empty array", () => {
      const existing = createArchivedTask({ id: "existing" });
      storage.writeArchive({ tasks: [existing] });

      storage.appendArchive([]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
    });

    it("skips duplicate IDs", () => {
      const existing = createArchivedTask({
        id: "dup",
        name: "Original",
      });
      storage.writeArchive({ tasks: [existing] });

      const duplicate = createArchivedTask({
        id: "dup",
        name: "Duplicate",
      });
      storage.appendArchive([duplicate]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].name).toBe("Original");
    });
  });

  describe("searchArchive", () => {
    beforeEach(() => {
      const tasks = [
        createArchivedTask({
          id: "auth",
          name: "Add authentication",
          result: "Implemented JWT",
        }),
        createArchivedTask({
          id: "ui",
          name: "Update dashboard",
          result: "Fixed layout",
        }),
        createArchivedTask({
          id: "parent",
          name: "Epic task",
          archived_children: [
            {
              id: "child",
              name: "Add login page",
              result: "Done",
            },
          ],
        }),
      ];
      storage.writeArchive({ tasks });
    });

    it("searches by description", () => {
      const results = storage.searchArchive("auth");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("auth");
    });

    it("searches by result", () => {
      const results = storage.searchArchive("JWT");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("auth");
    });

    it("searches in archived children", () => {
      const results = storage.searchArchive("login");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("parent");
    });

    it("is case insensitive", () => {
      const results = storage.searchArchive("DASHBOARD");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("ui");
    });

    it("returns empty array when no matches", () => {
      const results = storage.searchArchive("nonexistent");
      expect(results).toHaveLength(0);
    });
  });

  describe("getArchived", () => {
    it("returns task by ID", () => {
      const task = createArchivedTask({ id: "target", name: "Target" });
      storage.writeArchive({ tasks: [task] });

      const result = storage.getArchived("target");
      expect(result?.name).toBe("Target");
    });

    it("returns undefined when not found", () => {
      const task = createArchivedTask({ id: "other" });
      storage.writeArchive({ tasks: [task] });

      const result = storage.getArchived("missing");
      expect(result).toBeUndefined();
    });
  });

  describe("removeArchived", () => {
    it("removes tasks by ID", () => {
      const tasks = [
        createArchivedTask({ id: "keep" }),
        createArchivedTask({ id: "remove" }),
      ];
      storage.writeArchive({ tasks });

      storage.removeArchived(["remove"]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("keep");
    });

    it("removes multiple tasks", () => {
      const tasks = [
        createArchivedTask({ id: "one" }),
        createArchivedTask({ id: "two" }),
        createArchivedTask({ id: "three" }),
      ];
      storage.writeArchive({ tasks });

      storage.removeArchived(["one", "three"]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("two");
    });

    it("does nothing when removing empty array", () => {
      const tasks = [createArchivedTask({ id: "keep" })];
      storage.writeArchive({ tasks });

      storage.removeArchived([]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
    });

    it("handles non-existent IDs gracefully", () => {
      const tasks = [createArchivedTask({ id: "keep" })];
      storage.writeArchive({ tasks });

      storage.removeArchived(["nonexistent"]);

      const store = storage.readArchive();
      expect(store.tasks).toHaveLength(1);
    });
  });

  describe("getIdentifier", () => {
    it("returns storage path", () => {
      expect(storage.getIdentifier()).toBe(tempDir);
    });
  });

  describe("round-trip", () => {
    it("preserves all fields through read-write cycle", () => {
      const task: ArchivedTask = {
        id: "full-task",
        parent_id: "parent-123",
        name: "Complete task",
        result: "Successfully completed",
        completed_at: "2024-01-15T10:00:00.000Z",
        archived_at: "2024-01-20T10:00:00.000Z",
        metadata: {
          github: {
            issueNumber: 42,
            issueUrl: "https://github.com/test/test/issues/42",
            repo: "test/test",
          },
        },
        archived_children: [
          { id: "child-1", name: "Subtask 1", result: "Done" },
        ],
      };

      storage.writeArchive({ tasks: [task] });
      const store = storage.readArchive();

      expect(store.tasks[0]).toEqual(task);
    });
  });
});
