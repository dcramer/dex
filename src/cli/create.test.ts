import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput } from "./test-helpers.js";

describe("create command", () => {
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

  it("creates a task and displays confirmation", async () => {
    await runCli(["create", "-d", "Test task", "--context", "Test context"], { storage });

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
