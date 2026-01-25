/**
 * Shared test utilities for CLI command tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import nock from "nock";
import { FileStorage } from "../core/storage.js";
import { Task, TaskStore } from "../types.js";

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

// ============ GitHub API Mocking ============

export interface GitHubIssueFixture {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels?: Array<{ name: string }>;
  pull_request?: unknown;
}

export interface GitHubMock {
  scope: nock.Scope;
  getIssue: (owner: string, repo: string, number: number, response: GitHubIssueFixture) => void;
  getIssue404: (owner: string, repo: string, number: number) => void;
  getIssue401: (owner: string, repo: string, number: number) => void;
  getIssue403: (owner: string, repo: string, number: number, rateLimited?: boolean) => void;
  getIssue500: (owner: string, repo: string, number: number) => void;
  getIssueTimeout: (owner: string, repo: string, number: number) => void;
  listIssues: (owner: string, repo: string, response: GitHubIssueFixture[]) => void;
  listIssues401: (owner: string, repo: string) => void;
  listIssues403: (owner: string, repo: string, rateLimited?: boolean) => void;
  listIssues404: (owner: string, repo: string) => void;
  listIssues500: (owner: string, repo: string) => void;
  listIssuesTimeout: (owner: string, repo: string) => void;
  createIssue: (owner: string, repo: string, response: GitHubIssueFixture) => void;
  createIssue401: (owner: string, repo: string) => void;
  createIssue403: (owner: string, repo: string, rateLimited?: boolean) => void;
  createIssue500: (owner: string, repo: string) => void;
  updateIssue: (owner: string, repo: string, number: number, response: GitHubIssueFixture) => void;
  updateIssue401: (owner: string, repo: string, number: number) => void;
  updateIssue403: (owner: string, repo: string, number: number, rateLimited?: boolean) => void;
  updateIssue404: (owner: string, repo: string, number: number) => void;
  updateIssue500: (owner: string, repo: string, number: number) => void;
  done: () => void;
}

/**
 * Set up nock interceptors for GitHub API.
 * Call mock.done() in afterEach to verify all expected requests were made.
 */
export function setupGitHubMock(): GitHubMock {
  const scope = nock("https://api.github.com");

  return {
    scope,

    getIssue(owner: string, repo: string, number: number, response: GitHubIssueFixture) {
      scope
        .get(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(200, response);
    },

    getIssue404(owner: string, repo: string, number: number) {
      scope
        .get(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(404, { message: "Not Found" });
    },

    getIssue401(owner: string, repo: string, number: number) {
      scope
        .get(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(401, {
          message: "Bad credentials",
          documentation_url: "https://docs.github.com/rest",
        });
    },

    getIssue403(owner: string, repo: string, number: number, rateLimited = false) {
      if (rateLimited) {
        scope
          .get(`/repos/${owner}/${repo}/issues/${number}`)
          .reply(403, {
            message: "API rate limit exceeded",
            documentation_url: "https://docs.github.com/rest/rate-limit",
          }, {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600),
          });
      } else {
        scope
          .get(`/repos/${owner}/${repo}/issues/${number}`)
          .reply(403, {
            message: "Resource not accessible by integration",
          });
      }
    },

    getIssue500(owner: string, repo: string, number: number) {
      scope
        .get(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(500, { message: "Internal Server Error" });
    },

    getIssueTimeout(owner: string, repo: string, number: number) {
      scope
        .get(`/repos/${owner}/${repo}/issues/${number}`)
        .delayConnection(30000)
        .reply(200, {});
    },

    listIssues(owner: string, repo: string, response: GitHubIssueFixture[]) {
      scope
        .get(`/repos/${owner}/${repo}/issues`)
        .query(true)
        .reply(200, response);
    },

    listIssues401(owner: string, repo: string) {
      scope
        .get(`/repos/${owner}/${repo}/issues`)
        .query(true)
        .reply(401, {
          message: "Bad credentials",
          documentation_url: "https://docs.github.com/rest",
        });
    },

    listIssues403(owner: string, repo: string, rateLimited = false) {
      if (rateLimited) {
        scope
          .get(`/repos/${owner}/${repo}/issues`)
          .query(true)
          .reply(403, {
            message: "API rate limit exceeded",
            documentation_url: "https://docs.github.com/rest/rate-limit",
          }, {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600),
          });
      } else {
        scope
          .get(`/repos/${owner}/${repo}/issues`)
          .query(true)
          .reply(403, {
            message: "Resource not accessible by integration",
          });
      }
    },

    listIssues404(owner: string, repo: string) {
      scope
        .get(`/repos/${owner}/${repo}/issues`)
        .query(true)
        .reply(404, { message: "Not Found" });
    },

    listIssues500(owner: string, repo: string) {
      scope
        .get(`/repos/${owner}/${repo}/issues`)
        .query(true)
        .reply(500, { message: "Internal Server Error" });
    },

    listIssuesTimeout(owner: string, repo: string) {
      scope
        .get(`/repos/${owner}/${repo}/issues`)
        .query(true)
        .delayConnection(30000)
        .reply(200, []);
    },

    createIssue(owner: string, repo: string, response: GitHubIssueFixture) {
      scope
        .post(`/repos/${owner}/${repo}/issues`)
        .reply(201, {
          ...response,
          html_url: `https://github.com/${owner}/${repo}/issues/${response.number}`,
        });
    },

    createIssue401(owner: string, repo: string) {
      scope
        .post(`/repos/${owner}/${repo}/issues`)
        .reply(401, {
          message: "Bad credentials",
          documentation_url: "https://docs.github.com/rest",
        });
    },

    createIssue403(owner: string, repo: string, rateLimited = false) {
      if (rateLimited) {
        scope
          .post(`/repos/${owner}/${repo}/issues`)
          .reply(403, {
            message: "API rate limit exceeded",
            documentation_url: "https://docs.github.com/rest/rate-limit",
          }, {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600),
          });
      } else {
        scope
          .post(`/repos/${owner}/${repo}/issues`)
          .reply(403, {
            message: "Resource not accessible by integration",
          });
      }
    },

    createIssue500(owner: string, repo: string) {
      scope
        .post(`/repos/${owner}/${repo}/issues`)
        .reply(500, { message: "Internal Server Error" });
    },

    updateIssue(owner: string, repo: string, number: number, response: GitHubIssueFixture) {
      scope
        .patch(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(200, {
          ...response,
          html_url: `https://github.com/${owner}/${repo}/issues/${response.number}`,
        });
    },

    updateIssue401(owner: string, repo: string, number: number) {
      scope
        .patch(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(401, {
          message: "Bad credentials",
          documentation_url: "https://docs.github.com/rest",
        });
    },

    updateIssue403(owner: string, repo: string, number: number, rateLimited = false) {
      if (rateLimited) {
        scope
          .patch(`/repos/${owner}/${repo}/issues/${number}`)
          .reply(403, {
            message: "API rate limit exceeded",
            documentation_url: "https://docs.github.com/rest/rate-limit",
          }, {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600),
          });
      } else {
        scope
          .patch(`/repos/${owner}/${repo}/issues/${number}`)
          .reply(403, {
            message: "Resource not accessible by integration",
          });
      }
    },

    updateIssue404(owner: string, repo: string, number: number) {
      scope
        .patch(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(404, { message: "Not Found" });
    },

    updateIssue500(owner: string, repo: string, number: number) {
      scope
        .patch(`/repos/${owner}/${repo}/issues/${number}`)
        .reply(500, { message: "Internal Server Error" });
    },

    done() {
      scope.done();
    },
  };
}

/**
 * Clean up all nock interceptors.
 * Call in afterEach to reset state between tests.
 */
export function cleanupGitHubMock(): void {
  nock.cleanAll();
}

/**
 * Create a minimal GitHub issue fixture.
 */
export function createIssueFixture(
  overrides: Partial<GitHubIssueFixture> & { number: number }
): GitHubIssueFixture {
  return {
    title: `Test Issue #${overrides.number}`,
    body: null,
    state: "open",
    labels: [],
    ...overrides,
  };
}

/**
 * Create an issue body with dex metadata for testing import round-trip.
 */
export interface TestSubtask {
  id: string;
  description: string;
  context?: string;
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
  if (value.includes("\n") || value.includes("-->") || value.startsWith("base64:")) {
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
    if (rm.priority !== undefined) lines.push(`<!-- dex:task:priority:${rm.priority} -->`);
    if (rm.completed !== undefined) lines.push(`<!-- dex:task:completed:${rm.completed} -->`);
    if (rm.created_at) lines.push(`<!-- dex:task:created_at:${rm.created_at} -->`);
    if (rm.updated_at) lines.push(`<!-- dex:task:updated_at:${rm.updated_at} -->`);
    if (rm.completed_at !== undefined) {
      lines.push(`<!-- dex:task:completed_at:${rm.completed_at ?? "null"} -->`);
    }
    if (rm.result !== undefined && rm.result !== null) {
      lines.push(`<!-- dex:task:result:${encodeValue(rm.result)} -->`);
    }
    if (rm.commit) {
      lines.push(`<!-- dex:task:commit_sha:${rm.commit.sha} -->`);
      if (rm.commit.message) lines.push(`<!-- dex:task:commit_message:${encodeValue(rm.commit.message)} -->`);
      if (rm.commit.branch) lines.push(`<!-- dex:task:commit_branch:${rm.commit.branch} -->`);
      if (rm.commit.url) lines.push(`<!-- dex:task:commit_url:${rm.commit.url} -->`);
      if (rm.commit.timestamp) lines.push(`<!-- dex:task:commit_timestamp:${rm.commit.timestamp} -->`);
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
      lines.push(`${indent}- [${formatCheckbox(st.completed)}] **${st.description}** \`${st.id}\``);
    }
    lines.push("");
    lines.push("## Task Details");
    lines.push("");
    for (const st of options.subtasks) {
      const checkbox = formatCheckbox(st.completed);
      const depthArrow = st.parentId ? "↳ " : "";
      lines.push("<details>");
      lines.push(`<summary>[${checkbox}] ${depthArrow}<b>${st.description}</b> <code>${st.id}</code></summary>`);
      lines.push(`<!-- dex:subtask:id:${st.id} -->`);
      if (st.parentId) lines.push(`<!-- dex:subtask:parent:${st.parentId} -->`);
      lines.push(`<!-- dex:subtask:priority:${st.priority ?? 1} -->`);
      lines.push(`<!-- dex:subtask:completed:${st.completed ?? false} -->`);
      if (st.created_at) lines.push(`<!-- dex:subtask:created_at:${st.created_at} -->`);
      if (st.updated_at) lines.push(`<!-- dex:subtask:updated_at:${st.updated_at} -->`);
      if (st.completed_at !== undefined) {
        lines.push(`<!-- dex:subtask:completed_at:${st.completed_at ?? "null"} -->`);
      }
      if (st.commit) {
        lines.push(`<!-- dex:subtask:commit_sha:${st.commit.sha} -->`);
        if (st.commit.message) lines.push(`<!-- dex:subtask:commit_message:${encodeValue(st.commit.message)} -->`);
        if (st.commit.branch) lines.push(`<!-- dex:subtask:commit_branch:${st.commit.branch} -->`);
        if (st.commit.url) lines.push(`<!-- dex:subtask:commit_url:${st.commit.url} -->`);
        if (st.commit.timestamp) lines.push(`<!-- dex:subtask:commit_timestamp:${st.commit.timestamp} -->`);
      }
      lines.push("");
      if (st.context) {
        lines.push("### Context");
        lines.push(st.context);
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

// ============ Task Fixtures ============

/**
 * Create a minimal Task fixture for testing.
 */
export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test123",
    parent_id: null,
    description: "Test task",
    context: "Test context",
    priority: 1,
    completed: false,
    result: null,
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    blockedBy: [],
    blocks: [],
    children: [],
    ...overrides,
  };
}

/**
 * Create a minimal TaskStore fixture for testing.
 */
export function createStore(tasks: Task[] = []): TaskStore {
  return { tasks };
}
