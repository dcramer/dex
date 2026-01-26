import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput } from "./test-helpers.js";

describe("help command", () => {
  let storage: FileStorage;
  let cleanup: () => void;
  let output: CapturedOutput;

  beforeEach(() => {
    const temp = createTempStorage();
    storage = temp.storage;
    cleanup = temp.cleanup;
    output = captureOutput();
  });

  afterEach(() => {
    output.restore();
    cleanup();
  });

  it("displays usage information", async () => {
    await runCli(["help"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("dex");
    expect(out).toContain("USAGE");
    expect(out).toContain("COMMANDS");
  });
});
