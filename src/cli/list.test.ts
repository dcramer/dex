import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput } from "./test-helpers.js";

describe("list command", () => {
  let storage: FileStorage;
  let cleanup: () => void;
  let output: CapturedOutput;
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

  it("shows empty state when no tasks", async () => {
    await runCli(["list"], { storage });
    expect(output.stdout.join("\n")).toContain("No tasks found");
  });

  it("lists created tasks", async () => {
    await runCli(["create", "-d", "Task one", "--context", "Context one"], { storage });
    output.stdout.length = 0;

    await runCli(["list"], { storage });
    expect(output.stdout.join("\n")).toContain("Task one");
  });

  it("outputs JSON with --json flag", async () => {
    await runCli(["create", "-d", "JSON task", "--context", "Context"], { storage });
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
});
