import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, CapturedOutput } from "./test-helpers.js";

describe("plan command", () => {
  let storage: FileStorage;
  let cleanup: () => void;
  let output: CapturedOutput;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp storage for dex tasks
    const tempStorageDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dex-cli-test-"),
    );
    storage = new FileStorage(tempStorageDir);
    cleanup = () => fs.rm(tempStorageDir, { recursive: true, force: true });

    // Create temp directory for plan files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dex-plan-test-"));

    output = captureOutput();
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
  });

  afterEach(async () => {
    output.restore();
    await cleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
  });

  it("creates task from plan file", async () => {
    const planPath = path.join(tempDir, "test-plan.md");
    await fs.writeFile(
      planPath,
      "# Plan: Test Feature\n\nFull plan content here.",
    );

    await runCli(["plan", planPath], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Created");
    expect(out).toContain("from plan");
    expect(out).toContain("Test Feature");
  });

  it("strips 'Plan:' prefix from title", async () => {
    const planPath = path.join(tempDir, "auth-plan.md");
    await fs.writeFile(planPath, "# Plan: Add Authentication\n\nDetails...");

    await runCli(["plan", planPath], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Add Authentication");
    expect(out).not.toContain("Plan: Add Authentication");
  });

  it("stores full plan content as task context", async () => {
    const planContent = `# Plan: Feature X

## Summary
Detailed summary here.

## Steps
1. First step
2. Second step`;

    const planPath = path.join(tempDir, "feature-x.md");
    await fs.writeFile(planPath, planContent);

    await runCli(["plan", planPath], { storage });

    // Get the task ID from output
    const out = output.stdout.join("\n");
    const match = out.match(/task ([a-z0-9]{8})/);
    expect(match).toBeTruthy();
    const taskId = match![1];

    // Verify the task contains full context using TaskService
    const { TaskService } = await import("../core/task-service.js");
    const service = new TaskService(storage);
    const tasks = await service.list({ all: true });
    const task = tasks.find((t) => t.id === taskId);
    expect(task).toBeTruthy();
    expect(task!.description).toBe(planContent);
    expect(task!.name).toBe("Feature X");
  });

  it("handles priority flag", async () => {
    const planPath = path.join(tempDir, "priority-plan.md");
    await fs.writeFile(planPath, "# High Priority Task\n\nContent...");

    await runCli(["plan", planPath, "--priority", "2"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("[p2]");
    expect(out).toContain("High Priority Task");
  });

  it("handles parent flag", async () => {
    // Create parent task first
    await runCli(
      ["create", "-n", "Parent", "--description", "Parent description"],
      { storage },
    );

    const { TaskService } = await import("../core/task-service.js");
    const service = new TaskService(storage);
    const tasks = await service.list({ all: true });
    const parentId = tasks[0].id;

    // Create plan as subtask
    const planPath = path.join(tempDir, "subtask-plan.md");
    await fs.writeFile(planPath, "# Subtask Plan\n\nSubtask content...");

    await runCli(["plan", planPath, "--parent", parentId], { storage });

    // Verify subtask was created
    const allTasks = await service.list({ all: true });
    const subtask = allTasks.find((t) => t.name === "Subtask Plan");
    expect(subtask).toBeTruthy();
    expect(subtask!.parent_id).toBe(parentId);
  });

  it("shows help with --help flag", async () => {
    await runCli(["plan", "--help"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("dex plan");
    expect(out).toContain("Create task from plan markdown file");
    expect(out).toContain("--priority");
    expect(out).toContain("--parent");
  });

  it("requires file path", async () => {
    await expect(runCli(["plan"], { storage })).rejects.toThrow("process.exit");

    expect(output.stderr.join("\n")).toContain("Plan file path required");
  });

  it("handles non-existent file", async () => {
    const nonExistentPath = path.join(tempDir, "does-not-exist.md");

    await expect(
      runCli(["plan", nonExistentPath], { storage }),
    ).rejects.toThrow("process.exit");

    expect(output.stderr.join("\n")).toContain("ENOENT");
  });

  it("handles empty file", async () => {
    const emptyPath = path.join(tempDir, "empty.md");
    await fs.writeFile(emptyPath, "");

    await expect(runCli(["plan", emptyPath], { storage })).rejects.toThrow(
      "process.exit",
    );

    expect(output.stderr.join("\n")).toContain("Plan file is empty");
  });

  it("uses filename as fallback when no h1", async () => {
    const planPath = path.join(tempDir, "no-heading-plan.md");
    await fs.writeFile(planPath, "Just content without heading.");

    await runCli(["plan", planPath], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("no-heading-plan");
  });
});
