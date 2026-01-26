import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput, TASK_ID_REGEX } from "./test-helpers.js";

describe("edit command", () => {
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

  it("edits task description", async () => {
    await runCli(["create", "-d", "Original description", "--context", "ctx"], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["edit", taskId!, "-d", "Updated description"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("Updated description");
  });

  it("edits task context", async () => {
    await runCli(["create", "-d", "Test task", "--context", "Original context"], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["edit", taskId!, "--context", "New context details"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");

    // Verify context was updated by showing with verbose flag
    output.stdout.length = 0;
    await runCli(["show", taskId!, "--full"], { storage });
    const showOut = output.stdout.join("\n");
    expect(showOut).toContain("New context details");
  });

  it("edits task priority", async () => {
    await runCli(["create", "-d", "Test task", "--context", "ctx", "-p", "2"], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["edit", taskId!, "-p", "5"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("[p5]");
  });

  it("adds blocker to task", async () => {
    // Create blocker task
    await runCli(["create", "-d", "Blocker task", "--context", "ctx"], { storage });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create task to be blocked
    await runCli(["create", "-d", "Blocked task", "--context", "ctx"], { storage });
    const blockedId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Add blocker
    await runCli(["edit", blockedId!, "--add-blocker", blockerId!], { storage });
    expect(output.stdout.join("\n")).toContain("Updated");
    output.stdout.length = 0;

    // Verify blocker was added
    await runCli(["show", blockedId!], { storage });
    const showOut = output.stdout.join("\n");
    expect(showOut).toContain("Blocked by:");
    expect(showOut).toContain(blockerId!);
  });

  it("removes blocker from task", async () => {
    // Create blocker task
    await runCli(["create", "-d", "Blocker task", "--context", "ctx"], { storage });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create task with blocker
    await runCli(["create", "-d", "Blocked task", "--context", "ctx", "--blocked-by", blockerId!], { storage });
    const blockedId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Remove blocker
    await runCli(["edit", blockedId!, "--remove-blocker", blockerId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).not.toContain("Blocked by");
  });

  it("adds multiple blockers via comma-separated list", async () => {
    // Create two blocker tasks
    await runCli(["create", "-d", "Blocker 1", "--context", "ctx"], { storage });
    const blocker1 = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["create", "-d", "Blocker 2", "--context", "ctx"], { storage });
    const blocker2 = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create task to be blocked
    await runCli(["create", "-d", "Main task", "--context", "ctx"], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Add both blockers at once
    await runCli(["edit", taskId!, "--add-blocker", `${blocker1},${blocker2}`], { storage });
    expect(output.stdout.join("\n")).toContain("Updated");
    output.stdout.length = 0;

    // Verify both blockers were added
    await runCli(["show", taskId!], { storage });
    const showOut = output.stdout.join("\n");
    expect(showOut).toContain("Blocked by:");
    expect(showOut).toContain(blocker1!);
    expect(showOut).toContain(blocker2!);
  });

  it("fails for non-existent task", async () => {
    await expect(runCli(["edit", "nonexist", "-d", "New desc"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("not found");
  });

  it("can edit a completed task", async () => {
    await runCli(["create", "-d", "To complete", "--context", "ctx"], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Complete the task
    await runCli(["complete", taskId!, "-r", "Done"], { storage });
    output.stdout.length = 0;

    // Edit the completed task
    await runCli(["edit", taskId!, "-d", "Updated completed task"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("Updated completed task");
  });

  it("performs multiple edits in one command", async () => {
    await runCli(["create", "-d", "Original", "--context", "Original ctx", "-p", "1"], { storage });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["edit", taskId!, "-d", "New desc", "--context", "New ctx", "-p", "3"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("New desc");
    expect(out).toContain("[p3]");
    output.stdout.length = 0;

    // Verify context was updated
    await runCli(["show", taskId!, "--full"], { storage });
    const showOut = output.stdout.join("\n");
    expect(showOut).toContain("New ctx");
  });

  it("edits task parent", async () => {
    // Create parent task
    await runCli(["create", "-d", "Parent task", "--context", "ctx"], { storage });
    const parentId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create child task without parent
    await runCli(["create", "-d", "Child task", "--context", "ctx"], { storage });
    const childId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Set parent via edit
    await runCli(["edit", childId!, "--parent", parentId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
  });

  it("shows help with -h flag", async () => {
    await runCli(["edit", "-h"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("dex edit");
    expect(out).toContain("--description");
    expect(out).toContain("--context");
    expect(out).toContain("--add-blocker");
    expect(out).toContain("--remove-blocker");
  });

  it("requires task ID", async () => {
    await expect(runCli(["edit"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("Task ID is required");
  });
});
