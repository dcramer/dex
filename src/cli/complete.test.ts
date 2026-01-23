import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage.js";
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
});
