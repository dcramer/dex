import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput, TASK_ID_REGEX } from "./test-helpers.js";

describe("delete command", () => {
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

  it("deletes a task with force flag", async () => {
    await runCli(["create", "-d", "To delete", "--context", "ctx"], { storage });

    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["delete", taskId!, "-f"], { storage });
    expect(output.stdout.join("\n")).toContain("Deleted");
  });

  it("fails for nonexistent task", async () => {
    await expect(runCli(["delete", "nonexist", "-f"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("not found");
  });
});
