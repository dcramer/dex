import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput, TASK_ID_REGEX } from "./test-helpers.js";

describe("show command", () => {
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

  it("displays task details", async () => {
    await runCli(["create", "-d", "Show test", "--context", "Detailed context here"], { storage });

    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    expect(taskId).toBeDefined();

    output.stdout.length = 0;
    await runCli(["show", taskId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Show test");
    expect(out).toContain("Detailed context here");
  });

  it("fails for nonexistent task", async () => {
    await expect(runCli(["show", "nonexist"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("not found");
  });

  it("requires task ID", async () => {
    await expect(runCli(["show"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("Task ID is required");
  });
});
