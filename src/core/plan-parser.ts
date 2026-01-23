import * as fs from "fs/promises";
import * as path from "path";

export interface ParsedPlan {
  title: string;
  content: string;
}

/**
 * Parse a markdown plan file and extract title and content.
 *
 * @param filePath - Path to the plan markdown file
 * @returns ParsedPlan with title (from first h1 or filename) and full content
 * @throws Error if file is empty or cannot be read
 */
export async function parsePlanFile(filePath: string): Promise<ParsedPlan> {
  // Read file
  const content = await fs.readFile(filePath, "utf-8");

  // Validate not empty
  if (!content.trim()) {
    throw new Error("Plan file is empty");
  }

  // Extract first h1 heading: /^# (.+)$/m
  const match = content.match(/^# (.+)$/m);
  let title = match ? match[1].trim() : path.basename(filePath, ".md");

  // Strip "Plan: " prefix if present (case-insensitive)
  title = title.replace(/^Plan:\s*/i, "");

  return { title, content };
}
