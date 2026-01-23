import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { parsePlanFile } from "./plan-parser.js";

describe("plan-parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dex-plan-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("parses plan with h1 title", async () => {
    const planPath = path.join(tempDir, "test-plan.md");
    await fs.writeFile(planPath, "# My Plan Title\n\nSome content here.");

    const result = await parsePlanFile(planPath);

    expect(result.title).toBe("My Plan Title");
    expect(result.content).toBe("# My Plan Title\n\nSome content here.");
  });

  it("strips 'Plan:' prefix from title", async () => {
    const planPath = path.join(tempDir, "test-plan.md");
    await fs.writeFile(planPath, "# Plan: Add JWT Authentication\n\nDetails...");

    const result = await parsePlanFile(planPath);

    expect(result.title).toBe("Add JWT Authentication");
  });

  it("strips 'plan:' prefix (case-insensitive)", async () => {
    const planPath = path.join(tempDir, "test-plan.md");
    await fs.writeFile(planPath, "# plan: Feature Implementation\n\nDetails...");

    const result = await parsePlanFile(planPath);

    expect(result.title).toBe("Feature Implementation");
  });

  it("uses filename as fallback when no h1 heading", async () => {
    const planPath = path.join(tempDir, "my-feature-plan.md");
    await fs.writeFile(planPath, "Just some content without h1 heading.");

    const result = await parsePlanFile(planPath);

    expect(result.title).toBe("my-feature-plan");
    expect(result.content).toBe("Just some content without h1 heading.");
  });

  it("uses first h1 when multiple h1s exist", async () => {
    const planPath = path.join(tempDir, "test-plan.md");
    await fs.writeFile(
      planPath,
      "# First Title\n\nSome content.\n\n# Second Title\n\nMore content."
    );

    const result = await parsePlanFile(planPath);

    expect(result.title).toBe("First Title");
  });

  it("throws error for empty file", async () => {
    const planPath = path.join(tempDir, "empty.md");
    await fs.writeFile(planPath, "");

    await expect(parsePlanFile(planPath)).rejects.toThrow("Plan file is empty");
  });

  it("throws error for whitespace-only file", async () => {
    const planPath = path.join(tempDir, "whitespace.md");
    await fs.writeFile(planPath, "   \n\n  \t  \n");

    await expect(parsePlanFile(planPath)).rejects.toThrow("Plan file is empty");
  });

  it("throws error for non-existent file", async () => {
    const planPath = path.join(tempDir, "nonexistent.md");

    await expect(parsePlanFile(planPath)).rejects.toThrow("ENOENT");
  });

  it("preserves full markdown content", async () => {
    const content = `# Plan: Complex Feature

## Summary
This is a detailed plan.

## Steps
1. First step
2. Second step

## Acceptance Criteria
- Criterion 1
- Criterion 2`;

    const planPath = path.join(tempDir, "complex.md");
    await fs.writeFile(planPath, content);

    const result = await parsePlanFile(planPath);

    expect(result.content).toBe(content);
  });
});
