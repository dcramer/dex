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

    it("returns null when no metadata", () => {
      const task = createTask({
        metadata: undefined,
      });

      expect(service.getRemoteId(task)).toBeNull();
    });

    it("returns null when no shortcut metadata", () => {
      const task = createTask({
        metadata: {},
      });

      expect(service.getRemoteId(task)).toBeNull();
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
      const task = createTask({
        metadata: undefined,
      });

      expect(service.getRemoteUrl(task)).toBeNull();
    });
  });
});
