import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli } from "./index.js";
import {
  createCliTestFixture,
  createTaskAndGetId,
  CliTestFixture,
} from "./test-helpers.js";

describe("start command", () => {
  let fixture: CliTestFixture;

  beforeEach(() => {
    fixture = createCliTestFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("marks a pending task as in progress", async () => {
    const taskId = await createTaskAndGetId(fixture, "To start");

    await runCli(["start", taskId], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Started");
    expect(out).toContain(taskId);

    // Verify started_at is set
    const tasks = await fixture.storage.readAsync();
    const task = tasks.tasks.find((t) => t.id === taskId);
    expect(task?.started_at).toBeTruthy();
  });

  it("fails when starting an already-started task without force", async () => {
    const taskId = await createTaskAndGetId(fixture, "To start");

    // Start the task once
    await runCli(["start", taskId], { storage: fixture.storage });
    fixture.output.stdout.length = 0;
    fixture.output.stderr.length = 0;

    // Try to start it again without force
    await expect(
      runCli(["start", taskId], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const err = fixture.output.stderr.join("\n");
    expect(err).toContain("already in progress");
    expect(err).toContain("--force");
  });

  it("succeeds when starting an already-started task with --force", async () => {
    const taskId = await createTaskAndGetId(fixture, "To start");

    // Start the task once
    await runCli(["start", taskId], { storage: fixture.storage });

    // Get the original started_at
    let tasks = await fixture.storage.readAsync();
    const originalStartedAt = tasks.tasks.find(
      (t) => t.id === taskId,
    )?.started_at;

    // Wait a tiny bit to ensure timestamp would be different
    await new Promise((resolve) => setTimeout(resolve, 10));

    fixture.output.stdout.length = 0;
    fixture.output.stderr.length = 0;

    // Start again with force
    await runCli(["start", taskId, "--force"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("Started");

    // Verify started_at was updated
    tasks = await fixture.storage.readAsync();
    const newStartedAt = tasks.tasks.find((t) => t.id === taskId)?.started_at;
    expect(newStartedAt).toBeTruthy();
    expect(newStartedAt).not.toBe(originalStartedAt);
  });

  it("fails when starting a completed task", async () => {
    const taskId = await createTaskAndGetId(fixture, "To complete first");

    // Complete the task
    await runCli(["complete", taskId, "-r", "Done"], {
      storage: fixture.storage,
    });
    fixture.output.stdout.length = 0;
    fixture.output.stderr.length = 0;

    // Try to start it
    await expect(
      runCli(["start", taskId], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const err = fixture.output.stderr.join("\n");
    expect(err).toContain("Cannot start a completed task");
  });

  it("fails for nonexistent task", async () => {
    await expect(
      runCli(["start", "nonexist"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const err = fixture.output.stderr.join("\n");
    expect(err).toContain("not found");
  });

  it("requires task ID", async () => {
    await expect(
      runCli(["start"], { storage: fixture.storage }),
    ).rejects.toThrow("process.exit");

    const err = fixture.output.stderr.join("\n");
    expect(err).toContain("Task ID is required");
  });

  it("shows help with --help flag", async () => {
    await runCli(["start", "--help"], { storage: fixture.storage });

    const out = fixture.output.stdout.join("\n");
    expect(out).toContain("dex start");
    expect(out).toContain("--force");
    expect(out).toContain("in progress");
  });
});
