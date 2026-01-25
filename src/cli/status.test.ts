import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStorage } from "../core/storage.js";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput, TASK_ID_REGEX } from "./test-helpers.js";

describe("status command", () => {
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

  it("shows empty state when no tasks", async () => {
    await runCli(["status"], { storage });
    expect(output.stdout.join("\n")).toContain("No tasks yet");
    expect(output.stdout.join("\n")).toContain("dex create");
  });

  it("shows stats summary correctly", async () => {
    await runCli(["create", "-d", "Task one", "--context", "ctx"], { storage });
    await runCli(["create", "-d", "Task two", "--context", "ctx"], { storage });
    output.stdout.length = 0;

    await runCli(["status"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("|___/|___|_/\\_\\"); // ASCII art header
    expect(out).toContain("complete   ready   blocked"); // metric labels
    expect(out).toContain("0%"); // 0 completed of 2
    expect(out).toMatch(/ready.*blocked/); // metrics row
  });

  it("shows ready tasks section", async () => {
    await runCli(["create", "-d", "Ready task one", "--context", "ctx"], { storage });
    await runCli(["create", "-d", "Ready task two", "--context", "ctx"], { storage });
    output.stdout.length = 0;

    await runCli(["status"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Ready to Work");
    expect(out).toContain("Ready task one");
    expect(out).toContain("Ready task two");
  });

  it("shows blocked tasks with blocker info", async () => {
    // Create blocker task
    await runCli(["create", "-d", "Blocker task", "--context", "ctx"], { storage });
    const blockerId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    expect(blockerId).toBeDefined();

    // Create blocked task
    await runCli(["create", "-d", "Blocked task", "--context", "ctx", "--blocked-by", blockerId!], { storage });
    output.stdout.length = 0;

    await runCli(["status"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Blocked (1)");
    expect(out).toContain("Blocked task");
    expect(out).toContain(`[B: ${blockerId}]`);
  });

  it("shows recently completed tasks sorted by date", async () => {
    // Create and complete tasks
    await runCli(["create", "-d", "First completed", "--context", "ctx"], { storage });
    const firstId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    await runCli(["complete", firstId!, "--result", "done"], { storage });

    await runCli(["create", "-d", "Second completed", "--context", "ctx"], { storage });
    const secondId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
    await runCli(["complete", secondId!, "--result", "done"], { storage });

    output.stdout.length = 0;

    await runCli(["status"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Recently Completed");
    expect(out).toContain("First completed");
    expect(out).toContain("Second completed");

    // Second completed should appear before first (more recent)
    const firstIdx = out.indexOf("First completed");
    const secondIdx = out.indexOf("Second completed");
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it("outputs JSON with --json flag", async () => {
    await runCli(["create", "-d", "JSON task", "--context", "ctx"], { storage });
    output.stdout.length = 0;

    await runCli(["status", "--json"], { storage });

    const parsed = JSON.parse(output.stdout.join("\n"));
    expect(parsed).toHaveProperty("stats");
    expect(parsed.stats.total).toBe(1);
    expect(parsed.stats.pending).toBe(1);
    expect(parsed.stats.completed).toBe(0);
    expect(parsed.stats.ready).toBe(1);
    expect(parsed).toHaveProperty("readyTasks");
    expect(parsed).toHaveProperty("blockedTasks");
    expect(parsed).toHaveProperty("recentlyCompleted");
  });

  it("shows help with --help flag", async () => {
    await runCli(["status", "--help"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("dex status");
    expect(out).toContain("Show task dashboard overview");
    expect(out).toContain("--json");
    expect(out).toContain("EXAMPLES");
  });

  it("is the default command when dex is called with no args", async () => {
    await runCli(["create", "-d", "Test task", "--context", "ctx"], { storage });
    output.stdout.length = 0;

    // Run with no arguments
    await runCli([], { storage });

    const out = output.stdout.join("\n");
    // Should show status output, not list output
    expect(out).toContain("|___/|___|_/\\_\\"); // ASCII art header
    expect(out).toContain("Ready to Work");
  });

  it("limits ready tasks to 5 and shows overflow message", async () => {
    // Create 7 tasks
    for (let i = 1; i <= 7; i++) {
      await runCli(["create", "-d", `Task ${i}`, "--context", "ctx"], { storage });
    }
    output.stdout.length = 0;

    await runCli(["status"], { storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Ready to Work (7)");
    // Should show "and 2 more" since we limit to 5
    expect(out).toContain("and 2 more");
    expect(out).toContain("dex list --ready");
  });

  it("correctly counts blocked vs ready tasks", async () => {
    // Create 2 blocker tasks
    await runCli(["create", "-d", "Blocker A", "--context", "ctx"], { storage });
    const blockerAId = output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];

    await runCli(["create", "-d", "Blocker B", "--context", "ctx"], { storage });

    // Create 1 blocked task
    await runCli(["create", "-d", "Blocked", "--context", "ctx", "--blocked-by", blockerAId!], { storage });
    output.stdout.length = 0;

    await runCli(["status"], { storage });

    const out = output.stdout.join("\n");
    // Check the metric cards show correct counts (2 ready, 1 blocked)
    expect(out).toContain("complete   ready   blocked");
    expect(out).toContain("Ready to Work (2)");
    expect(out).toContain("Blocked (1)");
  });
});
