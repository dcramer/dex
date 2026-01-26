import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput } from "./test-helpers.js";

describe("completion command", () => {
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

  function getStdout(): string {
    return output.stdout.join("\n");
  }

  function getStderr(): string {
    return output.stderr.join("\n");
  }

  describe("bash completion", () => {
    it("generates valid bash completion script", async () => {
      await runCli(["completion", "bash"], { storage });

      const out = getStdout();
      expect(out).toContain("_dex_completion");
      expect(out).toContain("complete -F _dex_completion dex");
      expect(out).toContain("COMPREPLY");
      expect(out).toContain("compgen");
    });

    it("includes command completions", async () => {
      await runCli(["completion", "bash"], { storage });

      const out = getStdout();
      expect(out).toContain("create");
      expect(out).toContain("list");
      expect(out).toContain("show");
      expect(out).toContain("edit");
      expect(out).toContain("delete");
      expect(out).toContain("complete");
      expect(out).toContain("completion");
    });
  });

  describe("zsh completion", () => {
    it("generates valid zsh completion script", async () => {
      await runCli(["completion", "zsh"], { storage });

      const out = getStdout();
      expect(out).toContain("#compdef dex");
      expect(out).toContain("_dex()");
      expect(out).toContain("compdef _dex dex");
      expect(out).toContain("_arguments");
    });

    it("includes command descriptions", async () => {
      await runCli(["completion", "zsh"], { storage });

      const out = getStdout();
      expect(out).toContain("create:Create a new task");
      expect(out).toContain("list:List tasks");
      expect(out).toContain("show:View task details");
    });
  });

  describe("fish completion", () => {
    it("generates valid fish completion script", async () => {
      await runCli(["completion", "fish"], { storage });

      const out = getStdout();
      expect(out).toContain("complete -c dex");
      expect(out).toContain("function __dex_task_ids");
      expect(out).toContain("function __dex_needs_command");
    });

    it("includes command completions with descriptions", async () => {
      await runCli(["completion", "fish"], { storage });

      const out = getStdout();
      expect(out).toContain('-a "create" -d "Create a new task"');
      expect(out).toContain('-a "list" -d "List tasks"');
      expect(out).toContain('-a "show" -d "View task details"');
    });
  });

  describe("help", () => {
    it("displays help with --help flag", async () => {
      await runCli(["completion", "--help"], { storage });

      const out = getStdout();
      expect(out).toContain("dex completion");
      expect(out).toContain("USAGE");
      expect(out).toContain("SUPPORTED SHELLS");
      expect(out).toContain("bash");
      expect(out).toContain("zsh");
      expect(out).toContain("fish");
    });

    it("displays help with -h flag", async () => {
      await runCli(["completion", "-h"], { storage });

      const out = getStdout();
      expect(out).toContain("dex completion");
      expect(out).toContain("USAGE");
    });

    it("displays help when no shell argument provided", async () => {
      await runCli(["completion"], { storage });

      const out = getStdout();
      expect(out).toContain("dex completion");
      expect(out).toContain("SUPPORTED SHELLS");
    });
  });

  describe("error handling", () => {
    let mockExit: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as () => never);
    });

    afterEach(() => {
      mockExit.mockRestore();
    });

    it("fails for unsupported shell type", async () => {
      await expect(runCli(["completion", "powershell"], { storage })).rejects.toThrow("process.exit");

      const err = getStderr();
      expect(err).toContain("Unsupported shell: powershell");
      expect(err).toContain("bash, zsh, fish");
    });

    it("fails for invalid shell name", async () => {
      await expect(runCli(["completion", "notashell"], { storage })).rejects.toThrow("process.exit");
      expect(getStderr()).toContain("Unsupported shell: notashell");
    });
  });
});
