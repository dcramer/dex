import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { parseBeadsExportJsonl } from "./import.js";

function fixturePath(name: string): string {
  return path.resolve(import.meta.dirname, "fixtures", name);
}

describe("parseBeadsExportJsonl", () => {
  it("parses Beads JSONL and maps relationships", () => {
    const input = [
      JSON.stringify({
        id: "bd-1",
        title: "Parent",
        description: "Parent issue",
        status: "open",
        priority: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T01:00:00Z",
      }),
      JSON.stringify({
        id: "bd-2",
        title: "Child",
        description: "Child issue",
        status: "in_progress",
        priority: 2,
        created_at: "2026-01-01T02:00:00Z",
        updated_at: "2026-01-01T03:00:00Z",
        dependencies: [
          { issue_id: "bd-2", depends_on_id: "bd-1", type: "parent-child" },
          { issue_id: "bd-2", depends_on_id: "bd-1", type: "blocks" },
        ],
      }),
    ].join("\n");

    const parsed = parseBeadsExportJsonl(input);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.warnings).toEqual([]);

    const child = parsed.issues.find((issue) => issue.id === "bd-2");
    expect(child).toBeDefined();
    expect(child?.parentId).toBe("bd-1");
    expect(child?.blockerIds).toEqual(["bd-1"]);
    expect(child?.started_at).toBe("2026-01-01T03:00:00Z");
    expect(child?.beadsMetadata.status).toBe("in_progress");
  });

  it("parses records containing embedded Issue objects", () => {
    const input = JSON.stringify({
      Issue: {
        id: "bd-3",
        title: "Embedded",
        description: "Embedded format",
        status: "closed",
        priority: 0,
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T01:00:00Z",
        closed_at: "2026-02-01T01:00:00Z",
      },
      dependency_count: 0,
      dependent_count: 0,
    });

    const parsed = parseBeadsExportJsonl(input);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].id).toBe("bd-3");
    expect(parsed.issues[0].completed).toBe(true);
    expect(parsed.issues[0].result).toBe("Imported as completed from Beads");
  });

  it("prefers depends_on.id over dependency row id", () => {
    const input = [
      JSON.stringify({
        id: "bd-parent",
        title: "Parent",
        status: "open",
        priority: 1,
      }),
      JSON.stringify({
        id: "bd-child",
        title: "Child",
        status: "open",
        priority: 1,
        dependencies: [
          {
            id: "dep-row-123",
            issue_id: "bd-child",
            type: "blocks",
            depends_on: { id: "bd-parent" },
          },
        ],
      }),
    ].join("\n");

    const parsed = parseBeadsExportJsonl(input);
    const child = parsed.issues.find((issue) => issue.id === "bd-child");
    expect(child?.blockerIds).toEqual(["bd-parent"]);
  });

  it("throws on malformed JSON with line number", () => {
    expect(() =>
      parseBeadsExportJsonl('{"id":"bd-1","title":"ok"}\n{"bad"'),
    ).toThrow(/Invalid JSON on line 2/);
  });

  it("throws on duplicate issue ids", () => {
    const duplicate = [
      JSON.stringify({ id: "dup-1", title: "A" }),
      JSON.stringify({ id: "dup-1", title: "B" }),
    ].join("\n");

    expect(() => parseBeadsExportJsonl(duplicate)).toThrow(
      /Duplicate issue id in input: dup-1/,
    );
  });

  it("loads anonymized fixtures generated from local Beads state", () => {
    const graphFixture = fs.readFileSync(fixturePath("graph.jsonl"), "utf-8");
    const parsed = parseBeadsExportJsonl(graphFixture);

    expect(parsed.issues.length).toBeGreaterThan(0);

    const hasBlocks = parsed.issues.some(
      (issue) => issue.blockerIds.length > 0,
    );
    expect(hasBlocks).toBe(true);

    const hasClosed = parsed.issues.some((issue) => issue.completed);
    expect(hasClosed).toBe(true);
  });
});
