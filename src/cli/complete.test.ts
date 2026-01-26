import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput, TASK_ID_REGEX } from "./test-helpers.js";

describe("complete command", () => {
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

  it("marks task as completed with result", async () => {
    await runCli(["create", "-d", "To complete", "--context", "ctx"], { storage });

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

    await expect(runCli(["complete", taskId!], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("--result");
  });

  it("warns when completing a blocked task but still completes", async () => {
    // Create blocker task
    await runCli(["create", "-d", "Task A", "--context", "ctx"], { storage });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0; // Clear output before next command

    // Create blocked task
    await runCli(["create", "-d", "Task B", "--context", "ctx", "--blocked-by", blockerId!], { storage });
    const blockedId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Complete the blocked task
    await runCli(["complete", blockedId!, "-r", "Done anyway"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Warning:");
    expect(out).toContain("blocked by");
    expect(out).toContain("Task A");
    expect(out).toContain("Completed");
  });
});
