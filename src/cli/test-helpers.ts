/**
 * Shared test utilities for CLI command tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { FileStorage } from "../core/storage/index.js";

// Re-export shared test utilities from test-utils
export {
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createTask,
  createStore,
  createArchivedTask,
  type GitHubIssueFixture,
  type GitHubMock,
} from "../test-utils/github-mock.js";

export {
  setupShortcutMock,
  cleanupShortcutMock,
  createStoryFixture,
  createWorkflowFixture,
  createTeamFixture,
  createMemberFixture,
  type ShortcutStoryFixture,
  type ShortcutStoryLinkFixture,
  type ShortcutMock,
} from "../test-utils/shortcut-mock.js";

// ============ CLI-specific utilities ============

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
  console.error = (...args: unknown[]) =>
    stderr.push(args.map(String).join(" "));

  return {
    stdout,
    stderr,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

export function createTempStorage(): {
  storage: FileStorage;
  cleanup: () => void;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-cli-test-"));
  const storage = new FileStorage(tempDir);

  return {
    storage,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

/**
 * Create a temporary git repository with dex storage for testing.
 * Returns storage pointing to .dex in the git repo.
 */
export function createTempGitStorage(): {
  storage: FileStorage;
  gitRoot: string;
  cleanup: () => void;
} {
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dex-git-test-"));
  const originalCwd = process.cwd();

  try {
    // Initialize git repo
    execSync("git init", { cwd: gitRoot, stdio: "ignore" });

    // Create .dex directory
    const dexPath = path.join(gitRoot, ".dex");
    fs.mkdirSync(dexPath, { recursive: true });

    // Change to git root so getProjectConfigPath() works
    process.chdir(gitRoot);

    const storage = new FileStorage(dexPath);

    return {
      storage,
      gitRoot,
      cleanup: () => {
        process.chdir(originalCwd);
        fs.rmSync(gitRoot, { recursive: true, force: true });
      },
    };
  } catch (err) {
    process.chdir(originalCwd);
    throw err;
  }
}

// ============ Issue Body Builders for Import Testing ============

export interface TestSubtask {
  id: string;
  name: string;
  description?: string;
  completed?: boolean;
  result?: string | null;
  priority?: number;
  parentId?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  commit?: {
    sha: string;
    message?: string;
    branch?: string;
    url?: string;
    timestamp?: string;
  };
}

export interface TestRootTaskMetadata {
  id?: string;
  priority?: number;
  completed?: boolean;
  result?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  commit?: {
    sha: string;
    message?: string;
    branch?: string;
    url?: string;
    timestamp?: string;
  };
}

function formatCheckbox(completed?: boolean): string {
  return completed ? "x" : " ";
}

/**
 * Encode a value for HTML comment metadata.
 * Base64 encodes if it contains newlines or special characters.
 */
function encodeValue(value: string): string {
  if (
    value.includes("\n") ||
    value.includes("-->") ||
    value.startsWith("base64:")
  ) {
    return `base64:${Buffer.from(value, "utf-8").toString("base64")}`;
  }
  return value;
}

/**
 * Create a comprehensive dex issue body with full metadata for round-trip testing.
 */
export function createFullDexIssueBody(options: {
  context?: string;
  rootMetadata?: TestRootTaskMetadata;
  subtasks?: TestSubtask[];
}): string {
  const lines: string[] = [];

  // Root task metadata (HTML comments)
  if (options.rootMetadata) {
    const rm = options.rootMetadata;
    if (rm.id) lines.push(`<!-- dex:task:id:${rm.id} -->`);
    if (rm.priority !== undefined)
      lines.push(`<!-- dex:task:priority:${rm.priority} -->`);
    if (rm.completed !== undefined)
      lines.push(`<!-- dex:task:completed:${rm.completed} -->`);
    if (rm.created_at)
      lines.push(`<!-- dex:task:created_at:${rm.created_at} -->`);
    if (rm.updated_at)
      lines.push(`<!-- dex:task:updated_at:${rm.updated_at} -->`);
    if (rm.completed_at !== undefined) {
      lines.push(`<!-- dex:task:completed_at:${rm.completed_at ?? "null"} -->`);
    }
    if (rm.result !== undefined && rm.result !== null) {
      lines.push(`<!-- dex:task:result:${encodeValue(rm.result)} -->`);
    }
    if (rm.commit) {
      lines.push(`<!-- dex:task:commit_sha:${rm.commit.sha} -->`);
      if (rm.commit.message)
        lines.push(
          `<!-- dex:task:commit_message:${encodeValue(rm.commit.message)} -->`,
        );
      if (rm.commit.branch)
        lines.push(`<!-- dex:task:commit_branch:${rm.commit.branch} -->`);
      if (rm.commit.url)
        lines.push(`<!-- dex:task:commit_url:${rm.commit.url} -->`);
      if (rm.commit.timestamp)
        lines.push(`<!-- dex:task:commit_timestamp:${rm.commit.timestamp} -->`);
    }
  }

  // Context
  if (options.context) {
    if (lines.length > 0) lines.push("");
    lines.push(options.context);
  }

  // Subtasks
  if (options.subtasks?.length) {
    lines.push("");
    lines.push("## Task Tree");
    lines.push("");
    for (const st of options.subtasks) {
      const depth = st.parentId ? 1 : 0; // Simple depth for testing
      const indent = "  ".repeat(depth);
      lines.push(
        `${indent}- [${formatCheckbox(st.completed)}] **${st.name}** \`${st.id}\``,
      );
    }
    lines.push("");
    lines.push("## Task Details");
    lines.push("");
    for (const st of options.subtasks) {
      const checkbox = formatCheckbox(st.completed);
      const depthArrow = st.parentId ? "↳ " : "";
      lines.push("<details>");
      lines.push(
        `<summary>[${checkbox}] ${depthArrow}<b>${st.name}</b> <code>${st.id}</code></summary>`,
      );
      lines.push(`<!-- dex:subtask:id:${st.id} -->`);
      if (st.parentId) lines.push(`<!-- dex:subtask:parent:${st.parentId} -->`);
      lines.push(`<!-- dex:subtask:priority:${st.priority ?? 1} -->`);
      lines.push(`<!-- dex:subtask:completed:${st.completed ?? false} -->`);
      if (st.created_at)
        lines.push(`<!-- dex:subtask:created_at:${st.created_at} -->`);
      if (st.updated_at)
        lines.push(`<!-- dex:subtask:updated_at:${st.updated_at} -->`);
      if (st.completed_at !== undefined) {
        lines.push(
          `<!-- dex:subtask:completed_at:${st.completed_at ?? "null"} -->`,
        );
      }
      if (st.commit) {
        lines.push(`<!-- dex:subtask:commit_sha:${st.commit.sha} -->`);
        if (st.commit.message)
          lines.push(
            `<!-- dex:subtask:commit_message:${encodeValue(st.commit.message)} -->`,
          );
        if (st.commit.branch)
          lines.push(`<!-- dex:subtask:commit_branch:${st.commit.branch} -->`);
        if (st.commit.url)
          lines.push(`<!-- dex:subtask:commit_url:${st.commit.url} -->`);
        if (st.commit.timestamp)
          lines.push(
            `<!-- dex:subtask:commit_timestamp:${st.commit.timestamp} -->`,
          );
      }
      lines.push("");
      if (st.description) {
        lines.push("### Description");
        lines.push(st.description);
        lines.push("");
      }
      if (st.result) {
        lines.push("### Result");
        lines.push(st.result);
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Create legacy format issue body (old sync format without root metadata).
 */
export function createLegacyIssueBody(options: {
  context: string;
  taskId?: string;
}): string {
  const lines: string[] = [];
  if (options.taskId) {
    lines.push(`<!-- dex:task:${options.taskId} -->`);
    lines.push("");
  }
  lines.push(options.context);
  return lines.join("\n");
}

// ============ CLI Test Fixtures ============

import { vi } from "vitest";
import { runCli } from "./index.js";

export interface CliTestFixture {
  storage: FileStorage;
  output: CapturedOutput;
  mockExit: ReturnType<typeof vi.spyOn>;
  cleanup: () => void;
}

/**
 * Create a complete CLI test fixture with storage, output capture, and mocked process.exit.
 * Use in beforeEach and call fixture.cleanup() in afterEach.
 */
export function createCliTestFixture(): CliTestFixture {
  const temp = createTempStorage();
  const output = captureOutput();
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as () => never);

  return {
    storage: temp.storage,
    output,
    mockExit,
    cleanup: () => {
      output.restore();
      temp.cleanup();
      mockExit.mockRestore();
    },
  };
}

/**
 * Create a task via CLI and return its ID.
 * Clears output after capturing the ID.
 */
export async function createTaskAndGetId(
  fixture: CliTestFixture,
  name: string,
  options: { parent?: string; blockedBy?: string; description?: string } = {},
): Promise<string> {
  const args = ["create", name];
  if (options.description) {
    args.push("--description", options.description);
  }
  if (options.parent) {
    args.push("--parent", options.parent);
  }
  if (options.blockedBy) {
    args.push("--blocked-by", options.blockedBy);
  }

  await runCli(args, { storage: fixture.storage });

  const taskId = fixture.output.stdout.join("\n").match(TASK_ID_REGEX)?.[1];
  if (!taskId) {
    throw new Error("Failed to extract task ID from output");
  }
  fixture.output.stdout.length = 0;
  fixture.output.stderr.length = 0;

  return taskId;
}

// ============ Sync Registry Test Helpers ============

import { SyncRegistry } from "../core/sync/index.js";
import { GitHubSyncService } from "../core/github/index.js";
import { ShortcutSyncService } from "../core/shortcut/index.js";

export interface TestSyncRegistryOptions {
  github?: {
    owner?: string;
    repo?: string;
    token?: string;
  };
  shortcut?: {
    workspace?: string;
    team?: string;
    token?: string;
  };
}

/**
 * Create a SyncRegistry with configured services for testing.
 * Services are created directly without validation, suitable for use with mocks.
 */
export function createTestSyncRegistry(
  options: TestSyncRegistryOptions = {},
): SyncRegistry {
  const registry = new SyncRegistry();

  if (options.github) {
    const githubService = new GitHubSyncService({
      repo: {
        owner: options.github.owner ?? "test-owner",
        repo: options.github.repo ?? "test-repo",
      },
      token: options.github.token ?? "test-token",
    });
    registry.register(githubService);
  }

  if (options.shortcut) {
    const shortcutService = new ShortcutSyncService({
      workspace: options.shortcut.workspace ?? "test-workspace",
      team: options.shortcut.team ?? "test-team",
      token: options.shortcut.token ?? "test-token",
    });
    registry.register(shortcutService);
  }

  return registry;
}
