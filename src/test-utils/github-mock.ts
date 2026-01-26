/**
 * Shared GitHub API mocking utilities for tests.
 * Used by both CLI and core module tests.
 */

import nock from "nock";
import { Task, TaskStore } from "../types.js";

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
