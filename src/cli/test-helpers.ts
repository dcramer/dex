/**
 * Shared test utilities for CLI command tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileStorage } from "../core/storage.js";

// Task IDs are 8 lowercase alphanumeric characters
export const TASK_ID_REGEX = /\b([a-z0-9]{8})\b/;

export interface CapturedOutput {
  stdout: string[];
  stderr: string[];
  restore: () => void;
}

export function captureOutput(): CapturedOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));

  return {
    stdout,
    stderr,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

export function createTempStorage(): { storage: FileStorage; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-cli-test-"));
  const storage = new FileStorage(tempDir);

  return {
    storage,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}
