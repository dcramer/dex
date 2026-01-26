import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
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

  it("shows hierarchy tree for nested task", async () => {
    // Create epic -> task -> subtask hierarchy
    await runCli(["create", "-d", "Epic task", "--context", "ctx"], { storage });
    const epicId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["create", "-d", "Child task", "--context", "ctx", "--parent", epicId!], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["create", "-d", "Subtask", "--context", "ctx", "--parent", taskId!], { storage });
    const subtaskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["show", subtaskId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Epic task");
    expect(out).toContain("Child task");
    expect(out).toContain("← viewing"); // current task marker
  });

  it("shows subtask counts in hierarchy tree", async () => {
    // Create epic -> task -> subtask hierarchy
    await runCli(["create", "-d", "Epic", "--context", "ctx"], { storage });
    const epicId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["create", "-d", "Task", "--context", "ctx", "--parent", epicId!], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["create", "-d", "Subtask 1", "--context", "ctx", "--parent", taskId!], { storage });
    await runCli(["create", "-d", "Subtask 2", "--context", "ctx", "--parent", taskId!], { storage });

    output.stdout.length = 0;
    await runCli(["show", epicId!], { storage });

    const out = output.stdout.join("\n");
    // The tree shows subtask counts inline on each node
    expect(out).toContain("subtask");
    expect(out).toContain("← viewing");
  });

  it("shows navigation hint with dex list instead of --parent", async () => {
    await runCli(["create", "-d", "Parent", "--context", "ctx"], { storage });
    const parentId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];

    await runCli(["create", "-d", "Child", "--context", "ctx", "--parent", parentId!], { storage });

    output.stdout.length = 0;
    await runCli(["show", parentId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain(`dex list ${parentId}`);
    expect(out).not.toContain("--parent");
  });

  it("shows blocked by section when task has blockers", async () => {
    // Create blocker task
    await runCli(["create", "-d", "Task A", "--context", "ctx"], { storage });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0; // Clear output before next command

    // Create blocked task
    await runCli(["create", "-d", "Task B", "--context", "ctx", "--blocked-by", blockerId!], { storage });
    const blockedId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];

    output.stdout.length = 0;
    await runCli(["show", blockedId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Blocked by:");
    expect(out).toContain("Task A");
    expect(out).toContain(blockerId!);
  });

  it("shows blocks section when task blocks others", async () => {
    // Create blocker task
    await runCli(["create", "-d", "Task A", "--context", "ctx"], { storage });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0; // Clear output before next command

    // Create blocked task
    await runCli(["create", "-d", "Task B", "--context", "ctx", "--blocked-by", blockerId!], { storage });

    output.stdout.length = 0;
    await runCli(["show", blockerId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Blocks:");
    expect(out).toContain("Task B");
  });
});
