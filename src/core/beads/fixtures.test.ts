import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const FIXTURE_FILES = ["basic.jsonl", "graph.jsonl", "edge-cases.jsonl"];

describe("beads fixtures hygiene", () => {
  it("does not contain obvious sensitive patterns", () => {
    const fixturesDir = path.resolve(import.meta.dirname, "fixtures");
    const content = FIXTURE_FILES.map((file) =>
      fs.readFileSync(path.join(fixturesDir, file), "utf-8"),
    ).join("\n");

    expect(content).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(content).not.toContain("/Users/");
    expect(content).not.toContain("github.com/");
    expect(content).not.toContain("ghp_");
  });
});
