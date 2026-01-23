/**
 * CLI Command Integration Tests
 *
 * These test CLI commands end-to-end with real storage.
 * Only mock process.exit to prevent test termination.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileStorage } from "../../src/core/storage.js";
import { runCli } from "../../src/cli/index.js";

// Task IDs are 8 lowercase alphanumeric characters
const TASK_ID_REGEX = /\b([a-z0-9]{8})\b/;

interface CapturedOutput {
  stdout: string[];
  stderr: string[];
}

function captureOutput(): CapturedOutput & { restore: () => void } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));

  return {
    stdout,
    stderr,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

function createTempStorage(): { storage: FileStorage; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-cli-test-"));
  const storage = new FileStorage(tempDir);

  return {
    storage,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe("CLI commands", () => {
  let storage: FileStorage;
  let cleanup: () => void;
  let output: CapturedOutput & { restore: () => void };
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const temp = createTempStorage();
    storage = temp.storage;
    cleanup = temp.cleanup;
    output = captureOutput();

    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
  });

  afterEach(() => {
    output.restore();
    cleanup();
    mockExit.mockRestore();
  });

  describe("help", () => {
    it("displays usage information", async () => {
      await runCli(["help"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("dex");
      expect(out).toContain("USAGE");
      expect(out).toContain("COMMANDS");
    });

    it("responds to --help flag", async () => {
      await runCli(["--help"], { storage });

      expect(output.stdout.join("\n")).toContain("USAGE");
    });
  });

  describe("create", () => {
    it("creates a task and displays confirmation", async () => {
      await runCli(
        ["create", "-d", "Test task", "--context", "Test context"],
        { storage }
      );

      const out = output.stdout.join("\n");
      expect(out).toContain("Created");
      expect(out).toContain("Test task");
    });

    it("shows help with --help flag", async () => {
      await runCli(["create", "--help"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("dex create");
      expect(out).toContain("--description");
    });

    it("requires --description", async () => {
      await expect(
        runCli(["create", "--context", "context"], { storage })
      ).rejects.toThrow("process.exit");

      expect(output.stderr.join("\n")).toContain("--description");
    });

    it("requires --context", async () => {
      await expect(
        runCli(["create", "-d", "desc"], { storage })
      ).rejects.toThrow("process.exit");

      expect(output.stderr.join("\n")).toContain("--context");
    });
  });

  describe("list", () => {
    it("shows empty state when no tasks", async () => {
      await runCli(["list"], { storage });

      expect(output.stdout.join("\n")).toContain("No tasks found");
    });

    it("lists created tasks", async () => {
      await runCli(
        ["create", "-d", "Task one", "--context", "Context one"],
        { storage }
      );
      output.stdout.length = 0;

      await runCli(["list"], { storage });

      expect(output.stdout.join("\n")).toContain("Task one");
    });

    it("outputs JSON with --json flag", async () => {
      await runCli(
        ["create", "-d", "JSON task", "--context", "Context"],
        { storage }
      );
      output.stdout.length = 0;

      await runCli(["list", "--json"], { storage });

      const parsed = JSON.parse(output.stdout.join("\n"));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].description).toBe("JSON task");
    });

    it("filters by query", async () => {
      await runCli(["create", "-d", "Fix bug", "--context", "ctx"], { storage });
      await runCli(["create", "-d", "Add feature", "--context", "ctx"], { storage });
      output.stdout.length = 0;

      await runCli(["list", "-q", "bug"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Fix bug");
      expect(out).not.toContain("Add feature");
    });

    it("runs by default when no command provided", async () => {
      await runCli([], { storage });

      expect(output.stdout.join("\n")).toContain("No tasks found");
    });
  });

  describe("show", () => {
    it("displays task details", async () => {
      await runCli(
        ["create", "-d", "Show test", "--context", "Detailed context here"],
        { storage }
      );

      const createOut = output.stdout.join("\n");
      const taskId = createOut.match(TASK_ID_REGEX)?.[1];
      expect(taskId).toBeDefined();

      output.stdout.length = 0;
      await runCli(["show", taskId!], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Show test");
      expect(out).toContain("Detailed context here");
    });

    it("fails for nonexistent task", async () => {
      await expect(
        runCli(["show", "nonexist"], { storage })
      ).rejects.toThrow("process.exit");

      expect(output.stderr.join("\n")).toContain("not found");
    });

    it("requires task ID", async () => {
      await expect(runCli(["show"], { storage })).rejects.toThrow("process.exit");

      expect(output.stderr.join("\n")).toContain("Task ID is required");
    });
  });

  describe("complete", () => {
    it("marks task as completed with result", async () => {
      await runCli(
        ["create", "-d", "To complete", "--context", "ctx"],
        { storage }
      );

      const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
      output.stdout.length = 0;

      await runCli(["complete", taskId!, "-r", "Done successfully"], { storage });

      const out = output.stdout.join("\n");
      expect(out).toContain("Completed");
      expect(out).toContain("Done successfully");
    });

    it("requires --result", async () => {
      await runCli(["create", "-d", "Task", "--context", "ctx"], { storage });
      const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];

      await expect(
        runCli(["complete", taskId!], { storage })
      ).rejects.toThrow("process.exit");

      expect(output.stderr.join("\n")).toContain("--result");
    });
  });

  describe("delete", () => {
    it("deletes a task with force flag", async () => {
      await runCli(["create", "-d", "To delete", "--context", "ctx"], { storage });

      const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
      output.stdout.length = 0;

      await runCli(["delete", taskId!, "-f"], { storage });

      expect(output.stdout.join("\n")).toContain("Deleted");
    });

    it("fails for nonexistent task", async () => {
      await expect(
        runCli(["delete", "nonexist", "-f"], { storage })
      ).rejects.toThrow("process.exit");

      expect(output.stderr.join("\n")).toContain("not found");
    });
  });

  describe("unknown command", () => {
    it("shows error and suggests similar command", async () => {
      await expect(
        runCli(["craete"], { storage })
      ).rejects.toThrow("process.exit");

      const err = output.stderr.join("\n");
      expect(err).toContain("Unknown command");
      expect(err).toContain("create");
    });
  });
});
