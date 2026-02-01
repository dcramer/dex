/**
 * Shared Shortcut API mocking utilities for tests.
 * Used by both CLI and core module tests.
 */

import nock from "nock";

// ============ Shortcut API Mocking ============

export interface ShortcutStoryFixture {
  id: number;
  name: string;
  description?: string;
  completed: boolean;
  app_url: string;
  labels: Array<{ name: string }>;
  workflow_state_id?: number;
  sub_task_ids?: number[];
}

export interface ShortcutWorkflowFixture {
  id: number;
  name: string;
  states: Array<{
    id: number;
    name: string;
    type: "unstarted" | "started" | "done";
  }>;
}

export interface ShortcutTeamFixture {
  id: string;
  name: string;
  mention_name: string;
  workflow_ids: number[];
}

export interface ShortcutMemberFixture {
  id: string;
  profile: { name: string };
  workspace2: { url_slug: string };
}

export interface ShortcutStoryLinkFixture {
  id: number;
  subject_id: number;
  object_id: number;
  verb: "blocks" | "duplicates" | "relates to";
}

export interface ShortcutMock {
  scope: nock.Scope;
  getCurrentMember: (response: ShortcutMemberFixture) => void;
  getStory: (storyId: number, response: ShortcutStoryFixture) => void;
  getStory404: (storyId: number) => void;
  getStory401: (storyId: number) => void;
  getStory500: (storyId: number) => void;
  getStoryWithLinks: (
    storyId: number,
    response: ShortcutStoryFixture,
    storyLinks: ShortcutStoryLinkFixture[],
  ) => void;
  searchStories: (response: ShortcutStoryFixture[]) => void;
  searchStories401: () => void;
  searchStories500: () => void;
  createStory: (response: ShortcutStoryFixture) => void;
  createStory401: () => void;
  createStory500: () => void;
  updateStory: (storyId: number, response: ShortcutStoryFixture) => void;
  updateStory401: (storyId: number) => void;
  updateStory500: (storyId: number) => void;
  createStoryLink: (response: ShortcutStoryLinkFixture) => void;
  getWorkflow: (workflowId: number, response: ShortcutWorkflowFixture) => void;
  listWorkflows: (response: ShortcutWorkflowFixture[]) => void;
  getGroup: (groupId: string, response: ShortcutTeamFixture) => void;
  listGroups: (response: ShortcutTeamFixture[]) => void;
  listLabels: (response: Array<{ id: number; name: string }>) => void;
  createLabel: (response: { id: number; name: string }) => void;
  done: () => void;
}

/**
 * Set up nock interceptors for Shortcut API.
 * Call mock.done() in afterEach to verify all expected requests were made.
 */
export function setupShortcutMock(): ShortcutMock {
  const scope = nock("https://api.app.shortcut.com");

  return {
    scope,

    getCurrentMember(response: ShortcutMemberFixture) {
      scope.get("/api/v3/member").reply(200, response);
    },

    getStory(storyId: number, response: ShortcutStoryFixture) {
      scope
        .get(`/api/v3/stories/${storyId}`)
        .reply(200, { ...response, story_links: [] });
    },

    getStoryWithLinks(
      storyId: number,
      response: ShortcutStoryFixture,
      storyLinks: ShortcutStoryLinkFixture[],
    ) {
      scope
        .get(`/api/v3/stories/${storyId}`)
        .reply(200, { ...response, story_links: storyLinks });
    },

    getStory404(storyId: number) {
      scope
        .get(`/api/v3/stories/${storyId}`)
        .reply(404, { message: "Resource not found" });
    },

    getStory401(storyId: number) {
      scope
        .get(`/api/v3/stories/${storyId}`)
        .reply(401, { message: "Unauthorized" });
    },

    getStory500(storyId: number) {
      scope
        .get(`/api/v3/stories/${storyId}`)
        .reply(500, { message: "Internal Server Error" });
    },

    searchStories(response: ShortcutStoryFixture[]) {
      scope.get("/api/v3/search/stories").query(true).reply(200, {
        data: response,
        next: null,
        total: response.length,
      });
    },

    searchStories401() {
      scope
        .get("/api/v3/search/stories")
        .query(true)
        .reply(401, { message: "Unauthorized" });
    },

    searchStories500() {
      scope
        .get("/api/v3/search/stories")
        .query(true)
        .reply(500, { message: "Internal Server Error" });
    },

    createStory(response: ShortcutStoryFixture) {
      scope.post("/api/v3/stories").reply(201, response);
    },

    createStory401() {
      scope.post("/api/v3/stories").reply(401, { message: "Unauthorized" });
    },

    createStory500() {
      scope
        .post("/api/v3/stories")
        .reply(500, { message: "Internal Server Error" });
    },

    updateStory(storyId: number, response: ShortcutStoryFixture) {
      scope.put(`/api/v3/stories/${storyId}`).reply(200, response);
    },

    updateStory401(storyId: number) {
      scope
        .put(`/api/v3/stories/${storyId}`)
        .reply(401, { message: "Unauthorized" });
    },

    updateStory500(storyId: number) {
      scope
        .put(`/api/v3/stories/${storyId}`)
        .reply(500, { message: "Internal Server Error" });
    },

    createStoryLink(response: ShortcutStoryLinkFixture) {
      scope.post("/api/v3/story-links").reply(201, response);
    },

    getWorkflow(workflowId: number, response: ShortcutWorkflowFixture) {
      scope.get(`/api/v3/workflows/${workflowId}`).reply(200, response);
    },

    listWorkflows(response: ShortcutWorkflowFixture[]) {
      scope.get("/api/v3/workflows").reply(200, response);
    },

    getGroup(groupId: string, response: ShortcutTeamFixture) {
      scope.get(`/api/v3/groups/${groupId}`).reply(200, response);
    },

    listGroups(response: ShortcutTeamFixture[]) {
      scope.get("/api/v3/groups").reply(200, response);
    },

    listLabels(response: Array<{ id: number; name: string }>) {
      scope.get("/api/v3/labels").reply(200, response);
    },

    createLabel(response: { id: number; name: string }) {
      scope.post("/api/v3/labels").reply(201, response);
    },

    done() {
      scope.done();
    },
  };
}

/**
 * Clean up all nock interceptors for Shortcut.
 * Call in afterEach to reset state between tests.
 */
export function cleanupShortcutMock(): void {
  nock.cleanAll();
}

/**
 * Create a minimal Shortcut story fixture.
 */
export function createStoryFixture(
  overrides: Partial<ShortcutStoryFixture> & { id: number },
): ShortcutStoryFixture {
  return {
    name: `Test Story #${overrides.id}`,
    description: "",
    completed: false,
    app_url: `https://app.shortcut.com/test-workspace/story/${overrides.id}`,
    labels: [],
    workflow_state_id: 500000001,
    ...overrides,
  };
}

/**
 * Create a minimal Shortcut workflow fixture.
 */
export function createWorkflowFixture(
  overrides: Partial<ShortcutWorkflowFixture> & { id: number },
): ShortcutWorkflowFixture {
  return {
    name: "Development",
    states: [
      { id: 500000001, name: "Unstarted", type: "unstarted" },
      { id: 500000002, name: "In Progress", type: "started" },
      { id: 500000003, name: "Done", type: "done" },
    ],
    ...overrides,
  };
}

/**
 * Create a minimal Shortcut team fixture.
 */
export function createTeamFixture(
  overrides: Partial<ShortcutTeamFixture> = {},
): ShortcutTeamFixture {
  return {
    id: "test-team-uuid",
    name: "Test Team",
    mention_name: "test-team",
    workflow_ids: [500000000],
    ...overrides,
  };
}

/**
 * Create a minimal Shortcut member fixture.
 */
export function createMemberFixture(
  overrides: Partial<ShortcutMemberFixture> = {},
): ShortcutMemberFixture {
  return {
    id: "test-member-uuid",
    profile: { name: "Test User" },
    workspace2: { url_slug: "test-workspace" },
    ...overrides,
  };
}
