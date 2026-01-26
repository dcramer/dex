import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import {
  captureOutput,
  createTempGitStorage,
  CapturedOutput,
} from "./test-helpers.js";

describe("doctor command", () => {
  let storage: FileStorage;
  let gitRoot: string;
  let cleanup: () => void;
  let output: CapturedOutput;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const temp = createTempGitStorage();
    storage = temp.storage;
    gitRoot = temp.gitRoot;
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

  it("shows help with --help flag", async () => {
    await runCli(["doctor", "--help"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("dex doctor");
    expect(out).toContain("Check and repair");
    expect(out).toContain("--fix");
  });

  it("reports no issues when config and storage are valid", async () => {
    await runCli(["doctor"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Checking config");
    expect(out).toContain("Config valid");
    expect(out).toContain("Checking storage");
    expect(out).toContain("No issues found");
  });

  it("detects orphaned parent references", async () => {
    // Create a task and manually corrupt its parent_id
    const storagePath = storage.getIdentifier();
    const taskId = "test1234";
    const taskPath = path.join(storagePath, "tasks", `${taskId}.json`);

    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(
      taskPath,
      JSON.stringify({
        id: taskId,
        parent_id: "nonexistent",
        description: "Test task",
        context: "ctx",
        priority: 1,
        completed: false,
        result: null,
        blockedBy: [],
        blocks: [],
        children: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      }),
    );

    await runCli(["doctor"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("parent_id 'nonexistent' does not exist");
    expect(out).toContain("orphaned");
  });

  it("detects missing auto-sync config when github sync is enabled", async () => {
    // Create a config file with github sync enabled but no auto section
    const configPath = path.join(gitRoot, ".dex", "config.toml");

    fs.writeFileSync(
      configPath,
      `[sync.github]
enabled = true
`,
    );

    await runCli(["doctor"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Missing [sync.github.auto]");
    expect(out).toContain("project config");
  });

  it("fixes missing auto-sync config with --fix", async () => {
    // Create a config file with github sync enabled but no auto section
    const configPath = path.join(gitRoot, ".dex", "config.toml");

    fs.writeFileSync(
      configPath,
      `[sync.github]
enabled = true
`,
    );

    await runCli(["doctor", "--fix"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Fixed:");
    expect(out).toContain("[sync.github.auto]");

    // Verify the config was updated
    const updatedConfig = fs.readFileSync(configPath, "utf-8");
    expect(updatedConfig).toContain("on_change");
  });

  it("does not warn about auto-sync when it's already present", async () => {
    // Create a config file with github sync and auto section
    const configPath = path.join(gitRoot, ".dex", "config.toml");

    fs.writeFileSync(
      configPath,
      `[sync.github]
enabled = true

[sync.github.auto]
on_change = false
`,
    );

    await runCli(["doctor"], { storage });

    const out = output.stdout.join("\n");
    // Should NOT warn about missing auto-sync since it's present
    expect(out).not.toContain("Missing [sync.github.auto]");
    // May still warn about GITHUB_TOKEN, which is a separate check
  });
});
