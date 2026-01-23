import { describe, it, expect } from "vitest";
import {
  parseArgs,
  formatAge,
  levenshtein,
  getSuggestion,
  truncateText,
  stripAnsi,
  getStringFlag,
  getBooleanFlag,
} from "./utils.js";

describe("parseArgs", () => {
  const flagDefs = {
    description: { short: "d", hasValue: true },
    verbose: { short: "v", hasValue: false },
    priority: { short: "p", hasValue: true },
  };

  it("parses positional arguments", () => {
    const result = parseArgs(["abc123", "def456"], flagDefs);
    expect(result.positional).toEqual(["abc123", "def456"]);
    expect(result.flags).toEqual({});
  });

  it("parses long flags with values", () => {
    const result = parseArgs(["--description", "test value"], flagDefs);
    expect(result.flags.description).toBe("test value");
  });

  it("parses short flags with values", () => {
    const result = parseArgs(["-d", "test value"], flagDefs);
    expect(result.flags.description).toBe("test value");
  });

  it("parses boolean flags", () => {
    const result = parseArgs(["--verbose"], flagDefs);
    expect(result.flags.verbose).toBe(true);
  });

  it("parses short boolean flags", () => {
    const result = parseArgs(["-v"], flagDefs);
    expect(result.flags.verbose).toBe(true);
  });

  it("handles mixed positional and flags", () => {
    const result = parseArgs(["task1", "-d", "desc", "--verbose", "task2"], flagDefs);
    expect(result.positional).toEqual(["task1", "task2"]);
    expect(result.flags.description).toBe("desc");
    expect(result.flags.verbose).toBe(true);
  });

  it("handles multiple value flags", () => {
    const result = parseArgs(["-d", "desc", "-p", "5"], flagDefs);
    expect(result.flags.description).toBe("desc");
    expect(result.flags.priority).toBe("5");
  });
});

describe("getStringFlag / getBooleanFlag", () => {
  it("getStringFlag returns string value", () => {
    expect(getStringFlag({ foo: "bar" }, "foo")).toBe("bar");
  });

  it("getStringFlag returns undefined for empty string", () => {
    expect(getStringFlag({ foo: "" }, "foo")).toBeUndefined();
  });

  it("getStringFlag returns undefined for missing key", () => {
    expect(getStringFlag({}, "foo")).toBeUndefined();
  });

  it("getStringFlag returns undefined for boolean value", () => {
    expect(getStringFlag({ foo: true }, "foo")).toBeUndefined();
  });

  it("getBooleanFlag returns true for true", () => {
    expect(getBooleanFlag({ foo: true }, "foo")).toBe(true);
  });

  it("getBooleanFlag returns false for missing key", () => {
    expect(getBooleanFlag({}, "foo")).toBe(false);
  });

  it("getBooleanFlag returns false for string value", () => {
    expect(getBooleanFlag({ foo: "true" }, "foo")).toBe(false);
  });
});

describe("formatAge", () => {
  it("formats minutes ago", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatAge(fiveMinutesAgo)).toBe("5m ago");
  });

  it("formats hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatAge(threeHoursAgo)).toBe("3h ago");
  });

  it("formats days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(twoDaysAgo)).toBe("2d ago");
  });

  it("formats zero minutes for very recent", () => {
    const now = new Date().toISOString();
    expect(formatAge(now)).toBe("0m ago");
  });
});

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("test", "test")).toBe(0);
  });

  it("returns string length for empty comparison", () => {
    expect(levenshtein("test", "")).toBe(4);
    expect(levenshtein("", "test")).toBe(4);
  });

  it("calculates single character operations", () => {
    expect(levenshtein("test", "text")).toBe(1);
    expect(levenshtein("test", "tests")).toBe(1);
    expect(levenshtein("tests", "test")).toBe(1);
  });

  it("calculates multiple differences", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("getSuggestion", () => {
  it("suggests similar command for typo", () => {
    expect(getSuggestion("craete")).toBe("create");
    expect(getSuggestion("lst")).toBe("list");
    expect(getSuggestion("delte")).toBe("delete");
  });

  it("returns null for completely different input", () => {
    expect(getSuggestion("xyz")).toBeNull();
    expect(getSuggestion("foobar")).toBeNull();
  });

  it("is case insensitive", () => {
    expect(getSuggestion("CREATE")).toBe("create");
    expect(getSuggestion("LiSt")).toBe("list");
  });
});

describe("truncateText", () => {
  it("returns original text if shorter than max", () => {
    expect(truncateText("short", 10)).toBe("short");
  });

  it("returns original text if exactly max length", () => {
    expect(truncateText("exact", 5)).toBe("exact");
  });

  it("truncates with ellipsis if longer than max", () => {
    expect(truncateText("this is too long", 10)).toBe("this is...");
  });

  it("handles empty string", () => {
    expect(truncateText("", 10)).toBe("");
  });

  it("handles very small max length", () => {
    expect(truncateText("test", 3)).toBe("...");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
    expect(stripAnsi("\x1b[1m\x1b[32mbold green\x1b[0m")).toBe("bold green");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});
