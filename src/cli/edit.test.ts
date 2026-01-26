import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import {
  captureOutput,
  createTempStorage,
  CapturedOutput,
  TASK_ID_REGEX,
} from "./test-helpers.js";

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

  it("edits task name", async () => {
    await runCli(["create", "-n", "Original name", "--description", "desc"], {
      storage,
    });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["edit", taskId!, "-n", "Updated name"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("Updated name");
  });

  it("edits task description", async () => {
    await runCli(
      ["create", "-n", "Test task", "--description", "Original description"],
      { storage },
    );
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(
      ["edit", taskId!, "--description", "New description details"],
      { storage },
    );

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");

    // Verify description was updated by showing with verbose flag
    output.stdout.length = 0;
    await runCli(["show", taskId!, "--full"], { storage });
    const showOut = output.stdout.join("\n");
    expect(showOut).toContain("New description details");
  });

  it("edits task priority", async () => {
    await runCli(
      ["create", "-n", "Test task", "--description", "ctx", "-p", "2"],
      { storage },
    );
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["edit", taskId!, "-p", "5"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("[p5]");
  });

  it("adds blocker to task", async () => {
    // Create blocker task
    await runCli(["create", "-n", "Blocker task", "--description", "ctx"], {
      storage,
    });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create task to be blocked
    await runCli(["create", "-n", "Blocked task", "--description", "ctx"], {
      storage,
    });
    const blockedId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Add blocker
    await runCli(["edit", blockedId!, "--add-blocker", blockerId!], {
      storage,
    });
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
    await runCli(["create", "-n", "Blocker task", "--description", "ctx"], {
      storage,
    });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create task with blocker
    await runCli(
      [
        "create",
        "-n",
        "Blocked task",
        "--description",
        "ctx",
        "--blocked-by",
        blockerId!,
      ],
      { storage },
    );
    const blockedId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Remove blocker
    await runCli(["edit", blockedId!, "--remove-blocker", blockerId!], {
      storage,
    });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).not.toContain("Blocked by");
  });

  it("adds multiple blockers via comma-separated list", async () => {
    // Create two blocker tasks
    await runCli(["create", "-n", "Blocker 1", "--description", "ctx"], {
      storage,
    });
    const blocker1 = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(["create", "-n", "Blocker 2", "--description", "ctx"], {
      storage,
    });
    const blocker2 = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create task to be blocked
    await runCli(["create", "-n", "Main task", "--description", "ctx"], {
      storage,
    });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Add both blockers at once
    await runCli(
      ["edit", taskId!, "--add-blocker", `${blocker1},${blocker2}`],
      { storage },
    );
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
    await expect(
      runCli(["edit", "nonexist", "-n", "New desc"], { storage }),
    ).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("not found");
  });

  it("can edit a completed task", async () => {
    await runCli(["create", "-n", "To complete", "--description", "ctx"], {
      storage,
    });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Complete the task
    await runCli(["complete", taskId!, "-r", "Done"], { storage });
    output.stdout.length = 0;

    // Edit the completed task
    await runCli(["edit", taskId!, "-n", "Updated completed task"], {
      storage,
    });

    const out = output.stdout.join("\n");
    expect(out).toContain("Updated");
    expect(out).toContain("Updated completed task");
  });

  it("performs multiple edits in one command", async () => {
    await runCli(
      ["create", "-n", "Original", "--description", "Original ctx", "-p", "1"],
      { storage },
    );
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(
      [
        "edit",
        taskId!,
        "-n",
        "New desc",
        "--description",
        "New ctx",
        "-p",
        "3",
      ],
      { storage },
    );

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
    await runCli(["create", "-n", "Parent task", "--description", "ctx"], {
      storage,
    });
    const parentId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    // Create child task without parent
    await runCli(["create", "-n", "Child task", "--description", "ctx"], {
      storage,
    });
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
    expect(out).toContain("--name");
    expect(out).toContain("--description");
    expect(out).toContain("--add-blocker");
    expect(out).toContain("--remove-blocker");
  });

  it("requires task ID", async () => {
    await expect(runCli(["edit"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("Task ID is required");
  });
});
