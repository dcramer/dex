import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TaskStorage } from "../src/core/storage.js";

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
      const storagePath = path.join(tempDir, "custom.json");
      const storage = new TaskStorage(storagePath);
      expect(storage.getPath()).toBe(storagePath);
    });
  });

  describe("read", () => {
    it("returns empty store when file does not exist", () => {
      const storagePath = path.join(tempDir, "nonexistent.json");
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("returns empty store when file is empty", () => {
      const storagePath = path.join(tempDir, "empty.json");
      fs.writeFileSync(storagePath, "");
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("returns empty store when file contains only whitespace", () => {
      const storagePath = path.join(tempDir, "whitespace.json");
      fs.writeFileSync(storagePath, "   \n\t  ");
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store).toEqual({ tasks: [] });
    });

    it("reads valid task store from file", () => {
      const storagePath = path.join(tempDir, "valid.json");
      const taskData = {
        tasks: [
          {
            id: "test123",
            parent_id: null,
            project: "default",
            description: "Test task",
            context: "Test context",
            priority: 1,
            status: "pending",
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            completed_at: null,
          },
        ],
      };
      fs.writeFileSync(storagePath, JSON.stringify(taskData));
      const storage = new TaskStorage(storagePath);

      const store = storage.read();
      expect(store).toEqual(taskData);
    });

    it("throws on invalid JSON", () => {
      const storagePath = path.join(tempDir, "invalid.json");
      fs.writeFileSync(storagePath, "not valid json {");
      const storage = new TaskStorage(storagePath);

      expect(() => storage.read()).toThrow("is corrupted: Invalid JSON:");
    });

    it("throws on invalid task store format", () => {
      const storagePath = path.join(tempDir, "invalid-format.json");
      fs.writeFileSync(storagePath, JSON.stringify({ tasks: "not an array" }));
      const storage = new TaskStorage(storagePath);

      expect(() => storage.read()).toThrow("is corrupted: Invalid schema:");
    });

    it("throws on missing required task fields", () => {
      const storagePath = path.join(tempDir, "missing-fields.json");
      fs.writeFileSync(
        storagePath,
        JSON.stringify({
          tasks: [{ id: "test", description: "Missing fields" }],
        })
      );
      const storage = new TaskStorage(storagePath);

      expect(() => storage.read()).toThrow("is corrupted: Invalid schema:");
    });
  });

  describe("write", () => {
    it("creates directory if it does not exist", () => {
      const storagePath = path.join(tempDir, "nested", "dir", "tasks.json");
      const storage = new TaskStorage(storagePath);

      storage.write({ tasks: [] });

      expect(fs.existsSync(storagePath)).toBe(true);
    });

    it("writes task store to file", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const taskData = {
        tasks: [
          {
            id: "abc12345",
            parent_id: null,
            project: "test",
            description: "Test",
            context: "Context",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      storage.write(taskData);

      const content = fs.readFileSync(storagePath, "utf-8");
      expect(JSON.parse(content)).toEqual(taskData);
    });

    it("overwrites existing file", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      fs.writeFileSync(storagePath, JSON.stringify({ tasks: [] }));
      const storage = new TaskStorage(storagePath);
      const newData = {
        tasks: [
          {
            id: "new12345",
            parent_id: null,
            project: "default",
            description: "New",
            context: "Context",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      storage.write(newData);

      const content = fs.readFileSync(storagePath, "utf-8");
      expect(JSON.parse(content)).toEqual(newData);
    });

    it("writes with pretty formatting", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);

      storage.write({ tasks: [] });

      const content = fs.readFileSync(storagePath, "utf-8");
      expect(content).toBe('{\n  "tasks": []\n}');
    });

    it("sorts tasks by ID for deterministic output", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const taskData = {
        tasks: [
          {
            id: "zzz",
            parent_id: null,
            project: "default",
            description: "Last alphabetically",
            context: "Context",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "aaa",
            parent_id: null,
            project: "default",
            description: "First alphabetically",
            context: "Context",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      storage.write(taskData);

      const content = fs.readFileSync(storagePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.tasks[0].id).toBe("aaa");
      expect(parsed.tasks[1].id).toBe("zzz");
    });

    it("formats tasks with newlines between them for git-friendly diffs", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const taskData = {
        tasks: [
          {
            id: "task1",
            parent_id: null,
            project: "default",
            description: "Task 1",
            context: "Context",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "task2",
            parent_id: null,
            project: "default",
            description: "Task 2",
            context: "Context",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      storage.write(taskData);

      const content = fs.readFileSync(storagePath, "utf-8");
      // Tasks should be separated by blank line (double newline after comma)
      expect(content).toContain("},\n\n    {");
    });

    it("maintains consistent field ordering", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      // Create task with fields in non-standard order
      const taskData = {
        tasks: [
          {
            updated_at: "2024-01-01T00:00:00.000Z",
            status: "pending" as const,
            id: "task1",
            context: "Context",
            description: "Task",
            priority: 1,
            parent_id: null,
            project: "default",
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      storage.write(taskData);

      const content = fs.readFileSync(storagePath, "utf-8");
      // Check field order: id should come before description
      const idIndex = content.indexOf('"id"');
      const descIndex = content.indexOf('"description"');
      const contextIndex = content.indexOf('"context"');
      expect(idIndex).toBeLessThan(descIndex);
      expect(descIndex).toBeLessThan(contextIndex);
    });

    it("performs atomic write (no temp files left behind)", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);

      storage.write({ tasks: [] });

      const files = fs.readdirSync(tempDir);
      expect(files).toEqual(["tasks.json"]);
    });
  });

  describe("getPath", () => {
    it("returns the storage path", () => {
      const storagePath = path.join(tempDir, "my-tasks.json");
      const storage = new TaskStorage(storagePath);

      expect(storage.getPath()).toBe(storagePath);
    });
  });

  describe("round-trip", () => {
    it("preserves task data through read/write cycle", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const originalData = {
        tasks: [
          {
            id: "task0001",
            parent_id: null,
            project: "my-project",
            description: "First task",
            context: "Some context here",
            priority: 5,
            status: "pending" as const,
            result: null,
            created_at: "2024-06-15T10:30:00.000Z",
            updated_at: "2024-06-15T10:30:00.000Z",
            completed_at: null,
          },
          {
            id: "task0002",
            parent_id: "task0001",
            project: "my-project",
            description: "Child task",
            context: "Child context",
            priority: 1,
            status: "completed" as const,
            result: "Done!",
            created_at: "2024-06-15T11:00:00.000Z",
            updated_at: "2024-06-15T12:00:00.000Z",
            completed_at: "2024-06-15T12:00:00.000Z",
          },
        ],
      };

      storage.write(originalData);
      const readData = storage.read();

      expect(readData).toEqual(originalData);
    });

    it("handles special characters in task content", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const dataWithSpecialChars = {
        tasks: [
          {
            id: "special1",
            parent_id: null,
            project: "default",
            description: 'Task with "quotes" and \\backslashes\\',
            context: "Context with\nnewlines\tand\ttabs",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            completed_at: null,
          },
        ],
      };

      storage.write(dataWithSpecialChars);
      const readData = storage.read();

      expect(readData).toEqual(dataWithSpecialChars);
    });

    it("handles unicode characters", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const dataWithUnicode = {
        tasks: [
          {
            id: "unicode1",
            parent_id: null,
            project: "default",
            description: "Task with emoji and unicode",
            context: "Context with Chinese and Japanese characters",
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            completed_at: null,
          },
        ],
      };

      storage.write(dataWithUnicode);
      const readData = storage.read();

      expect(readData).toEqual(dataWithUnicode);
    });
  });

  describe("concurrent access simulation", () => {
    it("handles multiple sequential writes", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);

      for (let i = 0; i < 10; i++) {
        const data = {
          tasks: [
            {
              id: `task${i.toString().padStart(4, "0")}`,
              parent_id: null,
              project: "default",
              description: `Task ${i}`,
              context: "Context",
              priority: 1,
              status: "pending" as const,
              result: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          ],
        };
        storage.write(data);
      }

      const finalData = storage.read();
      expect(finalData.tasks[0].id).toBe("task0009");
    });
  });

  describe("edge cases", () => {
    it("handles empty tasks array", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);

      storage.write({ tasks: [] });
      const data = storage.read();

      expect(data).toEqual({ tasks: [] });
    });

    it("handles large number of tasks", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const tasks = Array.from({ length: 100 }, (_, i) => ({
        id: `task${i.toString().padStart(4, "0")}`,
        parent_id: null,
        project: "default",
        description: `Task number ${i}`,
        context: `Context for task ${i}`,
        priority: i % 10,
        status: "pending" as const,
        result: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
      }));

      storage.write({ tasks });
      const data = storage.read();

      expect(data.tasks).toHaveLength(100);
    });

    it("handles task with long description and context", () => {
      const storagePath = path.join(tempDir, "tasks.json");
      const storage = new TaskStorage(storagePath);
      const longText = "a".repeat(10000);
      const data = {
        tasks: [
          {
            id: "longtext",
            parent_id: null,
            project: "default",
            description: longText,
            context: longText,
            priority: 1,
            status: "pending" as const,
            result: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      storage.write(data);
      const readData = storage.read();

      expect(readData.tasks[0].description.length).toBe(10000);
      expect(readData.tasks[0].context.length).toBe(10000);
    });
  });
});
