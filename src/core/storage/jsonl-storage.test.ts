import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { JsonlStorage } from "./jsonl-storage.js";
import type { Task, TaskStore } from "../../types.js";
import { DataCorruptionError, StorageError } from "../../errors.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc12345",
    name: "Test task",
    description: "",
    completed: false,
    priority: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    blocks: [],
    blockedBy: [],
    children: [],
    parent_id: null,
    metadata: null,
    ...overrides,
  };
}

describe("JsonlStorage", () => {
  let tempDir: string;
  let storage: JsonlStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-jsonl-test-"));
    storage = new JsonlStorage(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read()", () => {
    it("returns empty store when file does not exist", () => {
      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("returns empty store when file is empty", () => {
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      fs.writeFileSync(tasksFile, "", "utf-8");

      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("reads single task from JSONL file", () => {
      const task = createTask({ description: "Test context" });
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      fs.writeFileSync(tasksFile, JSON.stringify(task) + "\n", "utf-8");

      const store = storage.read();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0]).toEqual(task);
    });

    it("reads multiple tasks from JSONL file", () => {
      const task1 = createTask({
        id: "abc12345",
        name: "Task 1",
        description: "Context 1",
      });
      const task2 = createTask({
        id: "def67890",
        name: "Task 2",
        description: "Context 2",
        completed: true,
        priority: 2,
        completed_at: new Date().toISOString(),
        result: "Completed successfully",
      });

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content =
        JSON.stringify(task1) + "\n" + JSON.stringify(task2) + "\n";
      fs.writeFileSync(tasksFile, content, "utf-8");

      const store = storage.read();
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0]).toEqual(task1);
      expect(store.tasks[1]).toEqual(task2);
    });

    it("sorts tasks by ID", () => {
      const task1 = createTask({ id: "zzz99999", description: "Task Z" });
      const task2 = createTask({ id: "aaa11111", description: "Task A" });

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content =
        JSON.stringify(task1) + "\n" + JSON.stringify(task2) + "\n";
      fs.writeFileSync(tasksFile, content, "utf-8");

      const store = storage.read();
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0].id).toBe("aaa11111");
      expect(store.tasks[1].id).toBe("zzz99999");
    });

    it("skips empty lines", () => {
      const task = createTask();
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content = "\n" + JSON.stringify(task) + "\n\n";
      fs.writeFileSync(tasksFile, content, "utf-8");

      const store = storage.read();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0]).toEqual(task);
    });

    it("throws DataCorruptionError for invalid JSON", () => {
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      fs.writeFileSync(tasksFile, "{invalid json}\n", "utf-8");

      expect(() => storage.read()).toThrow(DataCorruptionError);
    });

    it("throws DataCorruptionError for invalid schema", () => {
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      fs.writeFileSync(
        tasksFile,
        JSON.stringify({ invalid: "data" }) + "\n",
        "utf-8",
      );

      expect(() => storage.read()).toThrow(DataCorruptionError);
    });

    it("throws StorageError when file cannot be read", () => {
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      fs.writeFileSync(tasksFile, "test", "utf-8");
      fs.chmodSync(tasksFile, 0o000);

      try {
        expect(() => storage.read()).toThrow(StorageError);
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(tasksFile, 0o644);
      }
    });
  });

  describe("write()", () => {
    it("creates directory if it does not exist", () => {
      const newTempDir = path.join(tempDir, "nested", "directory");
      const newStorage = new JsonlStorage(newTempDir);

      const store: TaskStore = { tasks: [] };
      newStorage.write(store);

      expect(fs.existsSync(newTempDir)).toBe(true);
    });

    it("writes empty store as empty file", () => {
      const store: TaskStore = { tasks: [] };
      storage.write(store);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content = fs.readFileSync(tasksFile, "utf-8");
      expect(content).toBe("");
    });

    it("writes single task to JSONL file", () => {
      const task = createTask({ description: "Test context" });
      const store: TaskStore = { tasks: [task] };
      storage.write(store);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content = fs.readFileSync(tasksFile, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(task);
    });

    it("writes multiple tasks to JSONL file", () => {
      const task1 = createTask({ id: "abc12345", description: "Task 1" });
      const task2 = createTask({ id: "def67890", description: "Task 2" });

      const store: TaskStore = { tasks: [task1, task2] };
      storage.write(store);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content = fs.readFileSync(tasksFile, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual(task1);
      expect(JSON.parse(lines[1])).toEqual(task2);
    });

    it("sorts tasks by ID before writing", () => {
      const task1 = createTask({ id: "zzz99999", description: "Task Z" });
      const task2 = createTask({ id: "aaa11111", description: "Task A" });

      const store: TaskStore = { tasks: [task1, task2] };
      storage.write(store);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content = fs.readFileSync(tasksFile, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      expect(JSON.parse(lines[0]).id).toBe("aaa11111");
      expect(JSON.parse(lines[1]).id).toBe("zzz99999");
    });

    it("writes compact JSON (one line per task)", () => {
      const task = createTask({ description: "Test context" });
      const store: TaskStore = { tasks: [task] };
      storage.write(store);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      const content = fs.readFileSync(tasksFile, "utf-8");

      expect(content).not.toContain("  ");
      expect(content.endsWith("\n")).toBe(true);
    });

    it("uses atomic write (temp file + rename)", () => {
      const task = createTask();
      const store: TaskStore = { tasks: [task] };
      storage.write(store);

      const tempFile = path.join(tempDir, "tasks.jsonl.tmp");
      expect(fs.existsSync(tempFile)).toBe(false);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      expect(fs.existsSync(tasksFile)).toBe(true);
    });
  });

  describe("round-trip", () => {
    it("reads what was written", () => {
      const task1: Task = {
        id: "abc12345",
        name: "Task 1",
        description: "Context 1",
        completed: false,
        priority: 1,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        started_at: null,
        completed_at: null,
        result: null,
        blocks: ["def67890"],
        blockedBy: [],
        children: ["xyz00000"],
        parent_id: null,
        metadata: null,
      };

      const task2: Task = {
        id: "def67890",
        name: "Task 2",
        description: "Context 2",
        completed: true,
        priority: 2,
        created_at: "2024-01-02T00:00:00.000Z",
        updated_at: "2024-01-03T00:00:00.000Z",
        started_at: null,
        completed_at: "2024-01-03T00:00:00.000Z",
        result: "Done!",
        blocks: [],
        blockedBy: ["abc12345"],
        children: [],
        parent_id: null,
        metadata: {
          commit: {
            sha: "abc123",
            message: "Fix bug",
            branch: "main",
            url: "https://github.com/org/repo/commit/abc123",
            timestamp: "2024-01-03T00:00:00.000Z",
          },
        },
      };

      const originalStore: TaskStore = { tasks: [task1, task2] };
      storage.write(originalStore);

      const readStore = storage.read();
      expect(readStore).toEqual(originalStore);
    });
  });

  describe("async methods", () => {
    it("readAsync() works", async () => {
      const task = createTask();
      const tasksFile = path.join(tempDir, "tasks.jsonl");
      fs.writeFileSync(tasksFile, JSON.stringify(task) + "\n", "utf-8");

      const store = await storage.readAsync();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0]).toEqual(task);
    });

    it("writeAsync() works", async () => {
      const task = createTask();
      const store: TaskStore = { tasks: [task] };
      await storage.writeAsync(store);

      const tasksFile = path.join(tempDir, "tasks.jsonl");
      expect(fs.existsSync(tasksFile)).toBe(true);

      const readStore = storage.read();
      expect(readStore).toEqual(store);
    });
  });

  describe("interface methods", () => {
    it("getIdentifier() returns storage path", () => {
      expect(storage.getIdentifier()).toBe(tempDir);
    });

    it("isSync() returns true", () => {
      expect(storage.isSync()).toBe(true);
    });
  });

  describe("storage modes", () => {
    it("accepts path as string (backward compatibility)", () => {
      const customPath = path.join(tempDir, "custom");
      const customStorage = new JsonlStorage(customPath);

      expect(customStorage.getIdentifier()).toBe(customPath);
    });

    it("accepts path in options", () => {
      const customPath = path.join(tempDir, "custom");
      const customStorage = new JsonlStorage({ path: customPath });

      expect(customStorage.getIdentifier()).toBe(customPath);
    });
  });

  describe("migration from file-per-task format", () => {
    it("migrates tasks from tasks/ directory to tasks.jsonl", () => {
      // Set up old file-per-task format
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const task1 = createTask({ id: "abc12345", description: "Task 1" });
      const task2 = createTask({ id: "def67890", description: "Task 2" });

      fs.writeFileSync(
        path.join(tasksDir, "abc12345.json"),
        JSON.stringify(task1, null, 2),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tasksDir, "def67890.json"),
        JSON.stringify(task2, null, 2),
        "utf-8",
      );

      // Read should trigger migration
      const store = storage.read();

      expect(store.tasks).toHaveLength(2);
      expect(store.tasks.map((t) => t.id).sort()).toEqual([
        "abc12345",
        "def67890",
      ]);

      // Verify JSONL file was created
      const jsonlFile = path.join(tempDir, "tasks.jsonl");
      expect(fs.existsSync(jsonlFile)).toBe(true);

      // Verify old tasks directory was renamed to tasks.bak
      expect(fs.existsSync(tasksDir)).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "tasks.bak"))).toBe(true);
    });

    it("preserves all task fields during migration", () => {
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const task: Task = {
        id: "abc12345",
        name: "Test task",
        description: "Full context here",
        completed: true,
        priority: 3,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
        started_at: null,
        completed_at: "2024-01-02T00:00:00.000Z",
        result: "Task was completed",
        blocks: ["def67890"],
        blockedBy: ["xyz00000"],
        children: ["child123"],
        parent_id: "parent99",
        metadata: { commit: { sha: "abc123" } },
      };

      fs.writeFileSync(
        path.join(tasksDir, "abc12345.json"),
        JSON.stringify(task, null, 2),
        "utf-8",
      );

      const store = storage.read();

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0]).toEqual(task);
    });

    it("skips migration if tasks.jsonl already exists", () => {
      // Create both old and new format
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const oldTask = createTask({ id: "old00001", description: "Old task" });
      const newTask = createTask({ id: "new00001", description: "New task" });

      fs.writeFileSync(
        path.join(tasksDir, "old00001.json"),
        JSON.stringify(oldTask, null, 2),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tempDir, "tasks.jsonl"),
        JSON.stringify(newTask) + "\n",
        "utf-8",
      );

      // Read should use JSONL, not migrate
      const store = storage.read();

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("new00001");

      // Old tasks directory should still exist
      expect(fs.existsSync(tasksDir)).toBe(true);
    });

    it("handles empty tasks directory", () => {
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const store = storage.read();

      expect(store.tasks).toHaveLength(0);

      // Empty dir should still be backed up
      expect(fs.existsSync(tasksDir)).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "tasks.bak"))).toBe(true);
    });

    it("handles non-JSON files in tasks directory", () => {
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const task = createTask({ id: "abc12345" });
      fs.writeFileSync(
        path.join(tasksDir, "abc12345.json"),
        JSON.stringify(task, null, 2),
        "utf-8",
      );
      fs.writeFileSync(path.join(tasksDir, "readme.txt"), "ignore me", "utf-8");
      fs.writeFileSync(path.join(tasksDir, ".gitkeep"), "", "utf-8");

      const store = storage.read();

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("abc12345");
    });

    it("subsequent reads use JSONL without re-migrating", () => {
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const task = createTask({ id: "abc12345" });
      fs.writeFileSync(
        path.join(tasksDir, "abc12345.json"),
        JSON.stringify(task, null, 2),
        "utf-8",
      );

      // First read triggers migration
      storage.read();

      // Verify backup exists
      expect(fs.existsSync(path.join(tempDir, "tasks.bak"))).toBe(true);

      // Modify the backup (to verify we're not re-reading from it)
      const backupFile = path.join(tempDir, "tasks.bak", "abc12345.json");
      const modifiedTask = createTask({
        id: "abc12345",
        name: "MODIFIED",
      });
      fs.writeFileSync(
        backupFile,
        JSON.stringify(modifiedTask, null, 2),
        "utf-8",
      );

      // Second read should use JSONL
      const store = storage.read();

      expect(store.tasks[0].name).toBe("Test task"); // Original, not MODIFIED
    });

    it("handles backup directory name collision", () => {
      const tasksDir = path.join(tempDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      // Create existing tasks.bak
      const existingBackup = path.join(tempDir, "tasks.bak");
      fs.mkdirSync(existingBackup, { recursive: true });
      fs.writeFileSync(
        path.join(existingBackup, "old.json"),
        "old backup",
        "utf-8",
      );

      const task = createTask({ id: "abc12345" });
      fs.writeFileSync(
        path.join(tasksDir, "abc12345.json"),
        JSON.stringify(task, null, 2),
        "utf-8",
      );

      // Migration should use timestamped backup name
      storage.read();

      // Original tasks dir should be gone
      expect(fs.existsSync(tasksDir)).toBe(false);

      // Original tasks.bak should still exist with old content
      expect(fs.existsSync(existingBackup)).toBe(true);
      expect(fs.existsSync(path.join(existingBackup, "old.json"))).toBe(true);

      // Find the timestamped backup
      const backupDirs = fs
        .readdirSync(tempDir)
        .filter((f) => f.startsWith("tasks.bak."));
      expect(backupDirs.length).toBe(1);
    });
  });
});
