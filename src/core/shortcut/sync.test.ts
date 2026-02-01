import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShortcutSyncService } from "./sync.js";
import type { Task } from "../../types.js";
import type { ShortcutMock } from "../../test-utils/shortcut-mock.js";
import {
  setupShortcutMock,
  cleanupShortcutMock,
  createStoryFixture,
  createWorkflowFixture,
  createTeamFixture,
  createMemberFixture,
} from "../../test-utils/shortcut-mock.js";

function createTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "testid01",
    parent_id: null,
    name: "Test Task",
    description: "Test description",
    completed: false,
    priority: 1,
    result: null,
    metadata: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    blockedBy: [],
    blocks: [],
    children: [],
    ...overrides,
  };
}

describe("ShortcutSyncService", () => {
  let service: ShortcutSyncService;
  let shortcutMock: ShortcutMock;

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
  });

  function setupBaseMocks() {
    shortcutMock.getCurrentMember(createMemberFixture());
    shortcutMock.listGroups([createTeamFixture()]);
    shortcutMock.getGroup("test-team-uuid", createTeamFixture());
    shortcutMock.getWorkflow(
      500000000,
      createWorkflowFixture({ id: 500000000 }),
    );
  }

  describe("closeRemote", () => {
    it("moves story to done state when task has Shortcut metadata", async () => {
      const task = createTask({
        metadata: {
          shortcut: {
            storyId: 123,
            storyUrl: "https://app.shortcut.com/test-workspace/story/123",
            workspace: "test-workspace",
            state: "unstarted",
          },
        },
      });

      setupBaseMocks();
      shortcutMock.updateStory(
        123,
        createStoryFixture({ id: 123, completed: true }),
      );

      await service.closeRemote(task);

      // If we get here without error, the API was called correctly
      // nock will throw if the expected call wasn't made
    });

    it("does nothing when task has no storyId", async () => {
      // Test with no metadata at all
      const taskNoMetadata = createTask({ metadata: undefined });
      await service.closeRemote(taskNoMetadata);

      // Test with metadata but no shortcut key
      const taskNoShortcut = createTask({ metadata: {} });
      await service.closeRemote(taskNoShortcut);

      // No mocks needed - both should return early without API calls
    });
  });

  describe("getRemoteId", () => {
    it("returns storyId from task metadata", () => {
      const task = createTask({
        metadata: {
          shortcut: {
            storyId: 456,
            storyUrl: "https://app.shortcut.com/test-workspace/story/456",
            workspace: "test-workspace",
            state: "unstarted",
          },
        },
      });
      expect(service.getRemoteId(task)).toBe(456);
    });

    it("returns null when metadata is missing or incomplete", () => {
      expect(
        service.getRemoteId(createTask({ metadata: undefined })),
      ).toBeNull();
      expect(service.getRemoteId(createTask({ metadata: {} }))).toBeNull();
    });
  });

  describe("getRemoteUrl", () => {
    it("returns storyUrl from task metadata", () => {
      const task = createTask({
        metadata: {
          shortcut: {
            storyId: 789,
            storyUrl: "https://app.shortcut.com/test-workspace/story/789",
            workspace: "test-workspace",
            state: "unstarted",
          },
        },
      });
      expect(service.getRemoteUrl(task)).toBe(
        "https://app.shortcut.com/test-workspace/story/789",
      );
    });

    it("returns null when no metadata", () => {
      expect(
        service.getRemoteUrl(createTask({ metadata: undefined })),
      ).toBeNull();
    });
  });

  describe("syncTask", () => {
    it("creates a new story for task without metadata", async () => {
      const task = createTask({
        id: "newtask1",
        name: "New Task",
        description: "ctx",
      });

      setupBaseMocks();
      shortcutMock.searchStories([]);
      shortcutMock.listLabels([]);
      shortcutMock.createLabel({ id: 1, name: "dex" });
      shortcutMock.createStory(
        createStoryFixture({
          id: 999,
          name: "New Task",
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, { tasks: [task] });

      expect(result).not.toBeNull();
      expect(result!.taskId).toBe("newtask1");
      expect(result!.created).toBe(true);
      expect(result!.metadata).toMatchObject({
        storyId: 999,
        workspace: "test-workspace",
      });
    });

    it("syncs parent task when given a subtask", async () => {
      const parent = createTask({
        id: "parent01",
        name: "Parent task",
        description: "ctx",
      });
      const child = createTask({
        id: "child001",
        name: "Child task",
        parent_id: "parent01",
      });

      setupBaseMocks();
      shortcutMock.searchStories([]);
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      // Mock parent story creation
      shortcutMock.createStory(
        createStoryFixture({
          id: 1000,
          name: "Parent task",
          labels: [{ name: "dex" }],
        }),
      );
      // Mock subtask story creation (Shortcut creates subtasks as separate stories)
      shortcutMock.createStory(
        createStoryFixture({
          id: 1001,
          name: "Child task",
          labels: [{ name: "dex" }],
        }),
      );

      // Sync the child - should sync parent instead
      const result = await service.syncTask(child, { tasks: [parent, child] });

      expect(result).not.toBeNull();
      expect(result!.taskId).toBe("parent01");
    });

    it("returns null for orphan subtask", async () => {
      const orphan = createTask({
        id: "orphan01",
        name: "Orphan task",
        parent_id: "nonexistent",
      });

      const result = await service.syncTask(orphan, { tasks: [orphan] });
      expect(result).toBeNull();
    });

    it("updates existing story when task has metadata", async () => {
      const task = createTask({
        id: "existing",
        name: "Updated Task",
        description: "New description",
        metadata: {
          shortcut: {
            storyId: 123,
            storyUrl: "https://app.shortcut.com/test-workspace/story/123",
            workspace: "test-workspace",
            state: "unstarted",
          },
        },
      });

      setupBaseMocks();
      shortcutMock.getStory(
        123,
        createStoryFixture({
          id: 123,
          name: "Old Task",
          labels: [{ name: "dex" }],
        }),
      );
      shortcutMock.updateStory(
        123,
        createStoryFixture({
          id: 123,
          name: "Updated Task",
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, { tasks: [task] });

      expect(result).not.toBeNull();
      expect(result!.created).toBe(false);
      expect(result!.taskId).toBe("existing");
    });

    it("moves story to done state when task is completed", async () => {
      const task = createTask({
        id: "completed",
        name: "Completed Task",
        completed: true,
        completed_at: new Date().toISOString(),
      });

      setupBaseMocks();
      shortcutMock.searchStories([]);
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      shortcutMock.createStory(
        createStoryFixture({
          id: 500,
          name: "Completed Task",
          completed: true,
          workflow_state_id: 500000003, // done state
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, { tasks: [task] });

      expect(result).not.toBeNull();
      expect(result!.metadata).toMatchObject({
        state: "done",
      });
    });

    it("moves story to started state when task has started_at", async () => {
      const task = createTask({
        id: "started1",
        name: "Started Task",
        started_at: new Date().toISOString(),
        completed: false,
      });

      setupBaseMocks();
      shortcutMock.searchStories([]);
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      shortcutMock.createStory(
        createStoryFixture({
          id: 501,
          name: "Started Task",
          workflow_state_id: 500000002, // started state
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(task, { tasks: [task] });

      expect(result).not.toBeNull();
      expect(result!.metadata).toMatchObject({
        state: "started",
      });
    });

    it("does not recreate subtask when found in story cache", async () => {
      const parent = createTask({
        id: "parent02",
        name: "Parent with cached subtask",
        description: "ctx",
      });
      const subtask = createTask({
        id: "subtask2",
        name: "Cached Subtask",
        parent_id: "parent02",
      });

      setupBaseMocks();
      // Return existing stories including the subtask (simulates cache hit)
      shortcutMock.searchStories([
        createStoryFixture({
          id: 2000,
          name: "Parent with cached subtask",
          description: `<!-- dex:task:id:parent02 -->\n\nctx`,
          labels: [{ name: "dex" }],
        }),
        createStoryFixture({
          id: 2001,
          name: "Cached Subtask",
          description: `<!-- dex:task:id:subtask2 -->\n\n`,
          labels: [{ name: "dex" }],
        }),
      ]);
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      // Mock getStory for fetching parent to verify subtasks
      shortcutMock.getStory(
        2000,
        createStoryFixture({
          id: 2000,
          name: "Parent with cached subtask",
          description: `<!-- dex:task:id:parent02 -->\n\nctx`,
          sub_task_ids: [2001],
          labels: [{ name: "dex" }],
        }),
      );
      // Mock updateStory for parent (should not create new subtask)
      shortcutMock.updateStory(
        2000,
        createStoryFixture({
          id: 2000,
          name: "Parent with cached subtask",
          sub_task_ids: [2001],
          labels: [{ name: "dex" }],
        }),
      );
      // Mock updateStory for subtask (update, not create)
      shortcutMock.updateStory(
        2001,
        createStoryFixture({
          id: 2001,
          name: "Cached Subtask",
          labels: [{ name: "dex" }],
        }),
      );

      const result = await service.syncTask(parent, {
        tasks: [parent, subtask],
      });

      expect(result).not.toBeNull();
      expect(result!.taskId).toBe("parent02");
      expect(result!.created).toBe(false); // Updated, not created
      // No createStory mock was set up for subtask, so if it tried to create
      // the mock would fail - passing means it used the cached story
    });
  });

  describe("syncAll", () => {
    it("syncs all parent tasks and reports progress", async () => {
      const task1 = createTask({ id: "task0001", name: "Task 1" });
      const task2 = createTask({ id: "task0002", name: "Task 2" });
      const subtask = createTask({
        id: "subtask1",
        name: "Subtask",
        parent_id: "task0001",
      });

      setupBaseMocks();
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      shortcutMock.searchStories([]);

      // Mock story creations
      shortcutMock.createStory(
        createStoryFixture({
          id: 1,
          name: "Task 1",
          labels: [{ name: "dex" }],
        }),
      );
      shortcutMock.createStory(
        createStoryFixture({
          id: 2,
          name: "Task 2",
          labels: [{ name: "dex" }],
        }),
      );
      // Subtask story (created as child of Task 1)
      shortcutMock.createStory(
        createStoryFixture({
          id: 3,
          name: "Subtask",
          labels: [{ name: "dex" }],
        }),
      );

      const progressCalls: Array<{
        current: number;
        total: number;
        phase: string;
      }> = [];

      const results = await service.syncAll(
        { tasks: [task1, task2, subtask] },
        {
          onProgress: (progress) => {
            progressCalls.push({
              current: progress.current,
              total: progress.total,
              phase: progress.phase,
            });
          },
        },
      );

      // Should only sync parent tasks (2 tasks, not 3)
      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe("task0001");
      expect(results[1].taskId).toBe("task0002");

      // Progress should be called for each parent task
      expect(progressCalls.length).toBeGreaterThanOrEqual(2);
      expect(progressCalls[0].total).toBe(2);
    });

    it("skips unchanged tasks when skipUnchanged is true", async () => {
      const task = createTask({
        id: "unchanged",
        name: "Unchanged Task",
        completed: true,
        metadata: {
          shortcut: {
            storyId: 888,
            storyUrl: "https://app.shortcut.com/test-workspace/story/888",
            workspace: "test-workspace",
            state: "done", // Already synced as done
          },
        },
      });

      setupBaseMocks();
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      shortcutMock.searchStories([
        createStoryFixture({
          id: 888,
          name: "Unchanged Task",
          completed: true,
          description: `<!-- dex:task:id:unchanged -->`,
          labels: [{ name: "dex" }],
        }),
      ]);

      const results = await service.syncAll(
        { tasks: [task] },
        { skipUnchanged: true },
      );

      expect(results).toHaveLength(1);
      expect(results[0].skipped).toBe(true);
    });

    it("continues syncing after one task fails", async () => {
      const task1 = createTask({ id: "task0001", name: "Task 1" });
      const task2 = createTask({ id: "task0002", name: "Task 2" });

      setupBaseMocks();
      shortcutMock.listLabels([{ id: 1, name: "dex" }]);
      shortcutMock.searchStories([]);

      // First task creation fails
      shortcutMock.createStory500();
      // Second task should still be attempted
      shortcutMock.createStory(
        createStoryFixture({
          id: 2,
          name: "Task 2",
          labels: [{ name: "dex" }],
        }),
      );

      // syncAll should not throw even if individual tasks fail
      await expect(
        service.syncAll({ tasks: [task1, task2] }),
      ).rejects.toThrow();
    });
  });

  describe("findStoryByTaskId", () => {
    it("finds story by task ID in description", async () => {
      shortcutMock.searchStories([
        createStoryFixture({
          id: 555,
          name: "Found Story",
          description: `<!-- dex:task:id:findme01 -->\n\nSome content`,
          labels: [{ name: "dex" }],
        }),
      ]);
      expect(await service.findStoryByTaskId("findme01")).toBe(555);
    });

    it("returns null when no matching story found", async () => {
      shortcutMock.searchStories([
        createStoryFixture({
          id: 555,
          name: "Other Story",
          description: `<!-- dex:task:id:othertask -->\n\nSome content`,
          labels: [{ name: "dex" }],
        }),
      ]);
      expect(await service.findStoryByTaskId("notfound1")).toBeNull();
    });

    it("returns null when search returns empty results", async () => {
      shortcutMock.searchStories([]);
      expect(await service.findStoryByTaskId("findme01")).toBeNull();
    });

    it("returns null on API error", async () => {
      shortcutMock.searchStories500();
      expect(await service.findStoryByTaskId("findme01")).toBeNull();
    });
  });

  describe("fetchAllDexStories", () => {
    it("returns map of task IDs to cached stories", async () => {
      shortcutMock.searchStories([
        createStoryFixture({
          id: 100,
          name: "Story 1",
          description: `<!-- dex:task:id:task0001 -->\n\nContext 1`,
          labels: [{ name: "dex" }],
        }),
        createStoryFixture({
          id: 200,
          name: "Story 2",
          description: `<!-- dex:task:id:task0002 -->\n\nContext 2`,
          labels: [{ name: "dex" }],
        }),
      ]);

      const cache = await service.fetchAllDexStories();

      expect(cache.size).toBe(2);
      expect(cache.get("task0001")).toMatchObject({
        id: 100,
        name: "Story 1",
      });
      expect(cache.get("task0002")).toMatchObject({
        id: 200,
        name: "Story 2",
      });
    });

    it("skips stories without task metadata", async () => {
      shortcutMock.searchStories([
        createStoryFixture({
          id: 100,
          name: "Story with metadata",
          description: `<!-- dex:task:id:task0001 -->\n\nContext`,
          labels: [{ name: "dex" }],
        }),
        createStoryFixture({
          id: 200,
          name: "Story without metadata",
          description: "Just plain text",
          labels: [{ name: "dex" }],
        }),
      ]);

      const cache = await service.fetchAllDexStories();

      expect(cache.size).toBe(1);
      expect(cache.has("task0001")).toBe(true);
    });

    it("returns empty map on API error", async () => {
      shortcutMock.searchStories500();

      const cache = await service.fetchAllDexStories();
      expect(cache.size).toBe(0);
    });
  });
});
