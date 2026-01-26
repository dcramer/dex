import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage/index.js";
import { runCli } from "./index.js";
import {
  captureOutput,
  createTempStorage,
  CapturedOutput,
  TASK_ID_REGEX,
} from "./test-helpers.js";

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
    await runCli(
      ["create", "-n", "Show test", "--description", "Detailed context here"],
      { storage },
    );

    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    expect(taskId).toBeDefined();

    output.stdout.length = 0;
    await runCli(["show", taskId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Show test");
    expect(out).toContain("Detailed context here");
  });

  it("fails for nonexistent task", async () => {
    await expect(runCli(["show", "nonexist"], { storage })).rejects.toThrow(
      "process.exit",
    );
    expect(output.stderr.join("\n")).toContain("not found");
  });

  it("requires task ID", async () => {
    await expect(runCli(["show"], { storage })).rejects.toThrow("process.exit");
    expect(output.stderr.join("\n")).toContain("Task ID is required");
  });

  it("shows hierarchy tree for nested task", async () => {
    // Create epic -> task -> subtask hierarchy
    await runCli(["create", "-n", "Epic task", "--description", "ctx"], {
      storage,
    });
    const epicId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(
      [
        "create",
        "-n",
        "Child task",
        "--description",
        "ctx",
        "--parent",
        epicId!,
      ],
      { storage },
    );
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(
      ["create", "-n", "Subtask", "--description", "ctx", "--parent", taskId!],
      { storage },
    );
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
    await runCli(["create", "-n", "Epic", "--description", "ctx"], { storage });
    const epicId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(
      ["create", "-n", "Task", "--description", "ctx", "--parent", epicId!],
      { storage },
    );
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0;

    await runCli(
      [
        "create",
        "-n",
        "Subtask 1",
        "--description",
        "ctx",
        "--parent",
        taskId!,
      ],
      { storage },
    );
    await runCli(
      [
        "create",
        "-n",
        "Subtask 2",
        "--description",
        "ctx",
        "--parent",
        taskId!,
      ],
      { storage },
    );

    output.stdout.length = 0;
    await runCli(["show", epicId!], { storage });

    const out = output.stdout.join("\n");
    // The tree shows subtask counts inline on each node
    expect(out).toContain("subtask");
    expect(out).toContain("← viewing");
  });

  it("shows navigation hint with dex list instead of --parent", async () => {
    await runCli(["create", "-n", "Parent", "--description", "ctx"], {
      storage,
    });
    const parentId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];

    await runCli(
      ["create", "-n", "Child", "--description", "ctx", "--parent", parentId!],
      { storage },
    );

    output.stdout.length = 0;
    await runCli(["show", parentId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain(`dex list ${parentId}`);
    expect(out).not.toContain("--parent");
  });

  it("shows blocked by section when task has blockers", async () => {
    // Create blocker task
    await runCli(["create", "-n", "Task A", "--description", "ctx"], {
      storage,
    });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0; // Clear output before next command

    // Create blocked task
    await runCli(
      [
        "create",
        "-n",
        "Task B",
        "--description",
        "ctx",
        "--blocked-by",
        blockerId!,
      ],
      { storage },
    );
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
    await runCli(["create", "-n", "Task A", "--description", "ctx"], {
      storage,
    });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    output.stdout.length = 0; // Clear output before next command

    // Create blocked task
    await runCli(
      [
        "create",
        "-n",
        "Task B",
        "--description",
        "ctx",
        "--blocked-by",
        blockerId!,
      ],
      { storage },
    );

    output.stdout.length = 0;
    await runCli(["show", blockerId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Blocks:");
    expect(out).toContain("Task B");
  });

  it("shows GitHub issue metadata for task with direct GitHub link", async () => {
    // Create task with metadata
    await runCli(["create", "-n", "GitHub task", "--description", "ctx"], {
      storage,
    });
    const taskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    expect(taskId).toBeDefined();

    // Directly add GitHub metadata to the task via store read/write
    const store = storage.read();
    const task = store.tasks.find((t) => t.id === taskId);
    expect(task).toBeDefined();
    task!.metadata = {
      github: {
        issueNumber: 42,
        issueUrl: "https://github.com/owner/repo/issues/42",
        repo: "owner/repo",
      },
    };
    storage.write(store);

    output.stdout.length = 0;
    await runCli(["show", taskId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("GitHub Issue:");
    expect(out).toContain("#42 (owner/repo)");
    expect(out).toContain("https://github.com/owner/repo/issues/42");
    expect(out).not.toContain("(via parent)");
  });

  it("shows parent GitHub metadata for subtask with (via parent) indicator", async () => {
    // Create parent task
    await runCli(["create", "-n", "Parent task", "--description", "ctx"], {
      storage,
    });
    const parentId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    expect(parentId).toBeDefined();

    // Add GitHub metadata to parent via store read/write
    const store = storage.read();
    const parentTask = store.tasks.find((t) => t.id === parentId);
    expect(parentTask).toBeDefined();
    parentTask!.metadata = {
      github: {
        issueNumber: 99,
        issueUrl: "https://github.com/owner/repo/issues/99",
        repo: "owner/repo",
      },
    };
    storage.write(store);

    // Create subtask
    output.stdout.length = 0;
    await runCli(
      [
        "create",
        "-n",
        "Subtask",
        "--description",
        "ctx",
        "--parent",
        parentId!,
      ],
      { storage },
    );
    const subtaskId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    expect(subtaskId).toBeDefined();

    output.stdout.length = 0;
    await runCli(["show", subtaskId!], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("GitHub Issue:");
    expect(out).toContain("#99 (owner/repo)");
    expect(out).toContain("(via parent)");
  });
});
