import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TaskStorage } from "./storage/index.js";
import { createTask, createStore } from "../test-utils/github-mock.js";

describe("TaskStorage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-storage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("accepts a custom storage path", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      expect(storage.getPath()).toBe(storagePath);
    });
  });

  describe("read", () => {
    it("returns empty store when tasks directory does not exist", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("returns empty store when tasks directory is empty", () => {
      const storagePath = path.join(tempDir, ".dex");
      fs.mkdirSync(path.join(storagePath, "tasks"), { recursive: true });
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("reads valid tasks from individual files", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const taskData = {
        id: "test123",
        parent_id: null,
        name: "Test task",
        description: "Test context",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };
      fs.writeFileSync(
        path.join(tasksDir, "test123.json"),
        JSON.stringify(taskData),
      );
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store.tasks).toHaveLength(1);
      // Schema preprocessing adds default values for new fields
      expect(store.tasks[0]).toMatchObject(taskData);
    });

    it("reads multiple tasks from individual files", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const task1 = {
        id: "task1",
        parent_id: null,
        name: "Task 1",
        description: "Context 1",
        priority: 1,
        completed: false,
        result: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };
      const task2 = {
        id: "task2",
        parent_id: null,
        name: "Task 2",
        description: "Context 2",
        priority: 2,
        completed: false,
        result: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };
      fs.writeFileSync(
        path.join(tasksDir, "task1.json"),
        JSON.stringify(task1),
      );
      fs.writeFileSync(
        path.join(tasksDir, "task2.json"),
        JSON.stringify(task2),
      );

      const storage = new TaskStorage(storagePath);
      const store = storage.read();

      expect(store.tasks).toHaveLength(2);
      expect(store.tasks.map((t) => t.id).sort()).toEqual(["task1", "task2"]);
    });

    it("throws on invalid JSON in task file", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(path.join(tasksDir, "invalid.json"), "not valid json {");

      const storage = new TaskStorage(storagePath);
      expect(() => storage.read()).toThrow("is corrupted: Invalid JSON:");
    });

    it("throws on invalid task schema", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, "invalid.json"),
        JSON.stringify({ id: "test", description: "Missing fields" }),
      );

      const storage = new TaskStorage(storagePath);
      expect(() => storage.read()).toThrow("is corrupted: Invalid schema:");
    });

    it("ignores non-json files", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      const taskData = {
        id: "valid",
        parent_id: null,
        name: "Valid task",
        description: "Context",
        priority: 1,
        completed: false,
        result: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };
      fs.writeFileSync(
        path.join(tasksDir, "valid.json"),
        JSON.stringify(taskData),
      );
      fs.writeFileSync(path.join(tasksDir, "readme.txt"), "ignore this");

      const storage = new TaskStorage(storagePath);
      const store = storage.read();

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("valid");
    });

    it("throws on empty task files", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(path.join(tasksDir, "empty.json"), "");

      const storage = new TaskStorage(storagePath);
      expect(() => storage.read()).toThrow("is corrupted: File is empty");
    });
  });

  describe("write", () => {
    it("creates tasks directory if it does not exist", () => {
      const storagePath = path.join(tempDir, "nested", "dir", ".dex");
      const storage = new TaskStorage(storagePath);

      storage.write({ tasks: [] });

      expect(fs.existsSync(path.join(storagePath, "tasks"))).toBe(true);
    });

    it("writes each task to its own file", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const task = createTask({
        id: "abc12345",
        name: "Test",
        description: "Context",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
      });
      const taskData = createStore([task]);

      storage.write(taskData);

      const taskPath = path.join(storagePath, "tasks", "abc12345.json");
      expect(fs.existsSync(taskPath)).toBe(true);
      const content = fs.readFileSync(taskPath, "utf-8");
      expect(JSON.parse(content)).toEqual(task);
    });

    it("writes multiple tasks to separate files", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const taskData = createStore([
        createTask({ id: "task1", description: "Task 1" }),
        createTask({ id: "task2", description: "Task 2" }),
      ]);

      storage.write(taskData);

      const tasksDir = path.join(storagePath, "tasks");
      expect(fs.existsSync(path.join(tasksDir, "task1.json"))).toBe(true);
      expect(fs.existsSync(path.join(tasksDir, "task2.json"))).toBe(true);
    });

    it("deletes removed tasks", () => {
      const storagePath = path.join(tempDir, ".dex");
      const tasksDir = path.join(storagePath, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      // Create initial task file
      const oldTask = createTask({ id: "oldtask", description: "Old task" });
      fs.writeFileSync(
        path.join(tasksDir, "oldtask.json"),
        JSON.stringify(oldTask),
      );

      const storage = new TaskStorage(storagePath);
      const newData = createStore([
        createTask({ id: "newtask", description: "New" }),
      ]);

      storage.write(newData);

      expect(fs.existsSync(path.join(tasksDir, "oldtask.json"))).toBe(false);
      expect(fs.existsSync(path.join(tasksDir, "newtask.json"))).toBe(true);
    });

    it("writes with pretty formatting", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const taskData = createStore([
        createTask({ id: "pretty", description: "Test" }),
      ]);

      storage.write(taskData);

      const content = fs.readFileSync(
        path.join(storagePath, "tasks", "pretty.json"),
        "utf-8",
      );
      expect(content).toContain("\n"); // Pretty printed
      expect(content).toContain('  "id"'); // Indented
    });

    it("only creates task files in tasks directory", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);

      storage.write({ tasks: [] });

      const files = fs.readdirSync(storagePath);
      expect(files).toEqual(["tasks"]);
    });
  });

  describe("getPath", () => {
    it("returns the storage path", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);

      expect(storage.getPath()).toBe(storagePath);
    });
  });

  describe("migration from old format", () => {
    it("migrates tasks from old tasks.json to individual files", () => {
      const storagePath = path.join(tempDir, ".dex");
      fs.mkdirSync(storagePath, { recursive: true });

      // Old format with 'description' (title) and 'context' (details) fields
      const oldData = {
        tasks: [
          {
            id: "migrated1",
            parent_id: null,
            description: "Task 1",
            context: "Context",
            priority: 1,
            completed: false,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            completed_at: null,
          },
          {
            id: "migrated2",
            parent_id: null,
            description: "Task 2",
            context: "Context",
            priority: 2,
            completed: true,
            result: "Done",
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            completed_at: "2024-01-01T01:00:00.000Z",
          },
        ],
      };
      fs.writeFileSync(
        path.join(storagePath, "tasks.json"),
        JSON.stringify(oldData),
      );

      const storage = new TaskStorage(storagePath);
      const store = storage.read();

      // Verify migration happened
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks.map((t) => t.id).sort()).toEqual([
        "migrated1",
        "migrated2",
      ]);

      // Verify old file is removed
      expect(fs.existsSync(path.join(storagePath, "tasks.json"))).toBe(false);

      // Verify new files exist
      expect(
        fs.existsSync(path.join(storagePath, "tasks", "migrated1.json")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(storagePath, "tasks", "migrated2.json")),
      ).toBe(true);
    });

    it("removes empty old tasks.json without creating files", () => {
      const storagePath = path.join(tempDir, ".dex");
      fs.mkdirSync(storagePath, { recursive: true });
      fs.writeFileSync(path.join(storagePath, "tasks.json"), "");

      const storage = new TaskStorage(storagePath);
      const store = storage.read();

      expect(store.tasks).toEqual([]);
      expect(fs.existsSync(path.join(storagePath, "tasks.json"))).toBe(false);
    });

    it("leaves corrupted old tasks.json in place", () => {
      const storagePath = path.join(tempDir, ".dex");
      fs.mkdirSync(storagePath, { recursive: true });
      fs.writeFileSync(path.join(storagePath, "tasks.json"), "not valid json");

      const storage = new TaskStorage(storagePath);
      const store = storage.read();

      expect(store.tasks).toEqual([]);
      expect(fs.existsSync(path.join(storagePath, "tasks.json"))).toBe(true);
    });
  });

  describe("round-trip", () => {
    it("preserves task data through read/write cycle", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const originalData = createStore([
        createTask({
          id: "task0001",
          name: "First task",
          description: "Some context here",
          priority: 5,
          created_at: "2024-06-15T10:30:00.000Z",
          updated_at: "2024-06-15T10:30:00.000Z",
        }),
        createTask({
          id: "task0002",
          parent_id: "task0001",
          name: "Child task",
          description: "Child context",
          completed: true,
          result: "Done!",
          created_at: "2024-06-15T11:00:00.000Z",
          updated_at: "2024-06-15T12:00:00.000Z",
          completed_at: "2024-06-15T12:00:00.000Z",
        }),
      ]);

      storage.write(originalData);
      const readData = storage.read();

      // Sort for comparison since file order isn't guaranteed
      const sortedOriginal = [...originalData.tasks].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const sortedRead = [...readData.tasks].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      expect(sortedRead).toEqual(sortedOriginal);
    });

    it("handles special characters in task content", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const task = createTask({
        id: "special1",
        name: 'Task with "quotes" and \\backslashes\\',
        description: "Context with\nnewlines\tand\ttabs",
      });
      const dataWithSpecialChars = createStore([task]);

      storage.write(dataWithSpecialChars);
      const readData = storage.read();

      expect(readData.tasks[0]).toEqual(task);
    });

    it("handles unicode characters", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const task = createTask({
        id: "unicode1",
        name: "Task with emoji and unicode",
        description: "Context with Chinese and Japanese characters",
      });
      const dataWithUnicode = createStore([task]);

      storage.write(dataWithUnicode);
      const readData = storage.read();

      expect(readData.tasks[0]).toEqual(task);
    });
  });

  describe("concurrent access simulation", () => {
    it("handles multiple sequential writes", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);

      for (let i = 0; i < 10; i++) {
        const data = createStore([
          createTask({
            id: `task${i.toString().padStart(4, "0")}`,
            description: `Task ${i}`,
          }),
        ]);
        storage.write(data);
      }

      const finalData = storage.read();
      expect(finalData.tasks[0].id).toBe("task0009");
    });
  });

  describe("edge cases", () => {
    it("handles empty tasks array", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);

      storage.write(createStore([]));
      const data = storage.read();

      expect(data).toEqual({ tasks: [] });
    });

    it("handles large number of tasks", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const tasks = Array.from({ length: 100 }, (_, i) =>
        createTask({
          id: `task${i.toString().padStart(4, "0")}`,
          name: `Task number ${i}`,
          description: `Context for task ${i}`,
          priority: i % 10,
        }),
      );

      storage.write(createStore(tasks));
      const data = storage.read();

      expect(data.tasks).toHaveLength(100);
    });

    it("handles task with long name and description", () => {
      const storagePath = path.join(tempDir, ".dex");
      const storage = new TaskStorage(storagePath);
      const longText = "a".repeat(10000);
      const data = createStore([
        createTask({
          id: "longtext",
          name: longText,
          description: longText,
        }),
      ]);

      storage.write(data);
      const readData = storage.read();

      expect(readData.tasks[0].name.length).toBe(10000);
      expect(readData.tasks[0].description.length).toBe(10000);
    });
  });
});
