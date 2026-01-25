import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput } from "./test-helpers.js";

describe("runCli", () => {
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

  it("runs status by default when no command provided", async () => {
    await runCli([], { storage });
    // Status command shows empty state message
    expect(output.stdout.join("\n")).toContain("No tasks yet");
  });

  it("shows error and suggests similar command for typos", async () => {
    await expect(runCli(["craete"], { storage })).rejects.toThrow("process.exit");

    const err = output.stderr.join("\n");
    expect(err).toContain("Unknown command");
    expect(err).toContain("create");
  });

  it("routes to help command", async () => {
    await runCli(["help"], { storage });
    expect(output.stdout.join("\n")).toContain("USAGE");
  });

  it("responds to --help flag", async () => {
    await runCli(["--help"], { storage });
    expect(output.stdout.join("\n")).toContain("USAGE");
  });
});
