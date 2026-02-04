import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShortcutSyncService } from "./shortcut/sync.js";
import type { TaskStore, ShortcutMetadata } from "../types.js";
import type { SyncResult } from "./sync/registry.js";
import type { ShortcutMock } from "../test-utils/shortcut-mock.js";
import {
  setupShortcutMock,
  cleanupShortcutMock,
  createStoryFixture,
  createWorkflowFixture,
  createTeamFixture,
} from "../test-utils/shortcut-mock.js";
import { createTask, createStore } from "../test-utils/github-mock.js";

/**
 * Cast SyncResult metadata to ShortcutMetadata for test assertions.
 */
function getShortcutMetadata(
  result: SyncResult | null | undefined,
): ShortcutMetadata | undefined {
  return result?.metadata as ShortcutMetadata | undefined;
}

// Mock git remote detection and git operations
vi.mock("./git-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./git-utils.js")>();
  return {
    ...original,
    isCommitOnRemote: vi.fn(() => false), // Default: commits not on remote
  };
});

describe("ShortcutSyncService", () => {
  let service: ShortcutSyncService;
  let shortcutMock: ShortcutMock;

  const defaultWorkflow = createWorkflowFixture({ id: 500000000 });
  const defaultTeam = createTeamFixture();

  beforeEach(() => {
    shortcutMock = setupShortcutMock();

    service = new ShortcutSyncService({
      token: "test-token",
      workspace: "test-workspace",
      team: "test-team",
    });
  });

  afterEach(() => {
    cleanupShortcutMock();
    vi.restoreAllMocks();
  });

  describe("syncTask - preventing backwards state movement", () => {
    it("does not move done story backwards when syncing incomplete task without cache", async () => {
      // Critical test for the fix: when syncTask is called directly (not through syncAll),
      // there's no story cache, so getStoryChangeResult must fetch the current workflow state.
      // If the remote story is in "done" state, we must not move it backwards.
      const task = createTask({
        id: "incomplete-task",
        name: "Incomplete Task",
        completed: false, // Task is NOT completed locally
        metadata: {
          shortcut: {
            storyId: 99,
            storyUrl: "https://app.shortcut.com/test-workspace/story/99",
            workspace: "test-workspace",
            state: "unstarted", // Stale local metadata
          },
        },
      });
      const store = createStore([task]);

      // Setup: team lookup and workflow
      shortcutMock.listGroups([defaultTeam]);
      shortcutMock.getGroup(defaultTeam.id, defaultTeam);
      shortcutMock.getWorkflow(defaultWorkflow.id, defaultWorkflow);

      // The Shortcut story is already in "done" state (completed externally)
      shortcutMock.getStory(
        99,
        createStoryFixture({
          id: 99,
          name: task.name,
          description: `<!-- dex:task:id:incomplete-task -->`,
          completed: true, // DONE on remote
          workflow_state_id: 500000003, // Done state ID
          labels: [{ name: "dex" }],
        }),
      );

      // The update should NOT include a workflow_state_id that moves backwards
      // (the story should stay in done state)
      shortcutMock.updateStory(
        99,
        createStoryFixture({
          id: 99,
          name: task.name,
          completed: true, // Should stay done
          workflow_state_id: 500000003, // Should stay in done state
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, store);

      expect(result).not.toBeNull();
      // Expected state is "unstarted" (task not started), but story should stay in done on Shortcut
      expect(getShortcutMetadata(result)?.state).toBe("unstarted");
    });

    it("moves story to done when task is completed with verified commit", async () => {
      // Import and mock isCommitOnRemote
      const gitUtils = await import("./git-utils.js");
      vi.mocked(gitUtils.isCommitOnRemote).mockReturnValue(true);

      const task = createTask({
        id: "completed-task",
        name: "Completed Task",
        completed: true,
        metadata: {
          shortcut: {
            storyId: 100,
            storyUrl: "https://app.shortcut.com/test-workspace/story/100",
            workspace: "test-workspace",
            state: "started",
          },
          commit: {
            sha: "abc123",
            message: "Complete task",
          },
        },
      });
      const store = createStore([task]);

      // Setup: team lookup and workflow
      shortcutMock.listGroups([defaultTeam]);
      shortcutMock.getGroup(defaultTeam.id, defaultTeam);
      shortcutMock.getWorkflow(defaultWorkflow.id, defaultWorkflow);

      // Story is currently in started state
      shortcutMock.getStory(
        100,
        createStoryFixture({
          id: 100,
          name: task.name,
          description: `<!-- dex:task:id:completed-task -->`,
          completed: false,
          workflow_state_id: 500000002, // Started state
          labels: [{ name: "dex" }],
        }),
      );

      // Should update to done state
      shortcutMock.updateStory(
        100,
        createStoryFixture({
          id: 100,
          name: task.name,
          completed: true,
          workflow_state_id: 500000003, // Done state
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, store);

      expect(result).not.toBeNull();
      expect(getShortcutMetadata(result)?.state).toBe("done");
    });

    it("keeps story in started state when task completed without verified commit", async () => {
      // Reset mock to ensure commit is NOT on remote
      const gitUtils = await import("./git-utils.js");
      vi.mocked(gitUtils.isCommitOnRemote).mockReturnValue(false);

      // Task is completed but commit is not on remote - keep story in started state
      const task = createTask({
        id: "unverified-task",
        name: "Unverified Task",
        completed: true,
        started_at: new Date().toISOString(),
        metadata: {
          shortcut: {
            storyId: 101,
            storyUrl: "https://app.shortcut.com/test-workspace/story/101",
            workspace: "test-workspace",
            state: "started",
          },
          commit: {
            sha: "unpushed123",
            message: "Complete task",
          },
        },
      });
      const store = createStore([task]);

      // Setup: team lookup and workflow
      shortcutMock.listGroups([defaultTeam]);
      shortcutMock.getGroup(defaultTeam.id, defaultTeam);
      shortcutMock.getWorkflow(defaultWorkflow.id, defaultWorkflow);

      // Story is in started state
      shortcutMock.getStory(
        101,
        createStoryFixture({
          id: 101,
          name: task.name,
          description: `<!-- dex:task:id:unverified-task -->`,
          completed: false,
          workflow_state_id: 500000002, // Started state
          labels: [{ name: "dex" }],
        }),
      );

      // Should update but stay in started state (commit not verified)
      shortcutMock.updateStory(
        101,
        createStoryFixture({
          id: 101,
          name: task.name,
          completed: false,
          workflow_state_id: 500000002, // Still started
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, store);

      expect(result).not.toBeNull();
      expect(getShortcutMetadata(result)?.state).toBe("started");
    });
  });
});
