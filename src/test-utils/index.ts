/**
 * Unified test utilities for all dex tests.
 *
 * This module re-exports all shared test utilities from a single location.
 * Import from here for general test utilities:
 *
 *   import { createTask, testEnv, setupGitHubMock } from "../test-utils/index.js";
 *
 * For domain-specific test utilities, use the specialized modules:
 *   - CLI tests: import from "../cli/test-helpers.js"
 *   - MCP tests: import from "../mcp/test-helpers.js"
 */

// Test environment setup
export {
  testEnv,
  initTestEnv,
  cleanupTestEnv,
  type TestEnv,
} from "./test-env.js";

// Vitest re-exports for convenience
export {
  describe,
  it,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  vi,
} from "./test-env.js";

// GitHub API mocking and task fixtures
export {
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createTask,
  createStore,
  createArchivedTask,
  type GitHubIssueFixture,
  type GitHubMock,
} from "./github-mock.js";
