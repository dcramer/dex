/**
 * Storage format migrations for dex.
 *
 * Handles migrating between different storage formats
 * (e.g., from single tasks.json file to per-task files).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TaskStore, TaskStoreSchema } from "../../types.js";

/**
 * Migrate from old single-file format (tasks.json) to per-task files.
 * Returns true if migration was performed, false if not needed.
 */
export function migrateFromSingleFile(
  storagePath: string,
  writeStore: (store: TaskStore) => void
): boolean {
  const oldPath = path.join(storagePath, "tasks.json");

  if (!fs.existsSync(oldPath)) {
    return false;
  }

  let content: string;
  try {
    content = fs.readFileSync(oldPath, "utf-8");
  } catch {
    return false;
  }

  // Empty file - just clean it up
  if (!content.trim()) {
    fs.unlinkSync(oldPath);
    return false;
  }

  // Parse and validate the old format
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return false;
  }

  const result = TaskStoreSchema.safeParse(data);
  if (!result.success) {
    return false;
  }

  // Write tasks to new format and remove old file
  writeStore(result.data);
  fs.unlinkSync(oldPath);

  return true;
}
