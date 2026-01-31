/**
 * Shortcut API wrapper using the official @shortcut/client library.
 * Provides a simplified interface for dex integration.
 */

import {
  ShortcutClient,
  type Story,
  type StorySearchResult,
  type Workflow,
  type Group,
  type Label,
  type MemberInfo,
  type CreateStoryParams,
  type UpdateStory,
  type StorySearchResults,
  type WorkflowState,
  type StoryLink,
} from "@shortcut/client";

// Re-export types that are used externally
export type {
  Story,
  StorySearchResult,
  Workflow,
  WorkflowState,
  Label,
  MemberInfo,
  StoryLink,
};

export interface ShortcutTeam {
  id: string;
  name: string;
  mention_name: string;
  workflow_ids: number[];
}

export interface SearchStoriesResponse {
  data: StorySearchResult[];
  next?: string;
  total: number;
}

/**
 * Shortcut API wrapper for dex integration.
 * Uses the official @shortcut/client library.
 */
export class ShortcutApi {
  private client: ShortcutClient;
  private workspaceSlug: string | null = null;

  constructor(token: string, workspace?: string) {
    this.client = new ShortcutClient(token);
    this.workspaceSlug = workspace || null;
  }

  /**
   * Get the current member info (includes workspace slug).
   */
  async getCurrentMember(): Promise<MemberInfo> {
    const response = await this.client.getCurrentMemberInfo();
    return response.data;
  }

  /**
   * Get or fetch the workspace slug.
   */
  async getWorkspaceSlug(): Promise<string> {
    if (this.workspaceSlug) {
      return this.workspaceSlug;
    }
    const member = await this.getCurrentMember();
    this.workspaceSlug = member.workspace2.url_slug;
    return this.workspaceSlug;
  }

  /**
   * Create a new story.
   */
  async createStory(data: CreateStoryParams): Promise<Story> {
    const response = await this.client.createStory(data);
    return response.data;
  }

  /**
   * Update an existing story.
   */
  async updateStory(storyId: number, data: UpdateStory): Promise<Story> {
    const response = await this.client.updateStory(storyId, data);
    return response.data;
  }

  /**
   * Get a story by ID.
   */
  async getStory(storyId: number): Promise<Story> {
    const response = await this.client.getStory(storyId);
    return response.data;
  }

  /**
   * Search for stories.
   */
  async searchStories(query: string): Promise<SearchStoriesResponse> {
    const response = await this.client.searchStories({
      query,
      page_size: 100,
    });
    const results: StorySearchResults = response.data;
    return {
      data: results.data,
      next: results.next ?? undefined,
      total: results.total,
    };
  }

  /**
   * Create a subtask (story with parent relationship).
   * Creates a story with parent_story_id to link it as a Shortcut Sub-task.
   */
  async createSubtask(
    parentStoryId: number,
    data: CreateStoryParams,
  ): Promise<Story> {
    const response = await this.client.createStory({
      ...data,
      parent_story_id: parentStoryId,
    });
    return response.data;
  }

  /**
   * Convert an existing story into a subtask of another story.
   */
  async convertToSubtask(
    parentStoryId: number,
    subtaskStoryId: number,
  ): Promise<void> {
    await this.client.updateStory(subtaskStoryId, {
      parent_story_id: parentStoryId,
    });
  }

  /**
   * Remove a story from its parent (convert subtask to regular story).
   */
  async removeFromParent(subtaskStoryId: number): Promise<void> {
    await this.client.updateStory(subtaskStoryId, {
      parent_story_id: null,
    });
  }

  /**
   * Create a "blocks" relationship between two stories.
   * The subject story blocks the object story.
   */
  async createBlocksLink(
    blockerStoryId: number,
    blockedStoryId: number,
  ): Promise<StoryLink> {
    const response = await this.client.createStoryLink({
      subject_id: blockerStoryId,
      object_id: blockedStoryId,
      verb: "blocks",
    });
    return response.data;
  }

  /**
   * Get all story links for a story.
   */
  async getStoryLinks(storyId: number): Promise<StoryLink[]> {
    const story = await this.getStory(storyId);
    return story.story_links;
  }

  /**
   * Get a workflow by ID.
   */
  async getWorkflow(workflowId: number): Promise<Workflow> {
    const response = await this.client.getWorkflow(workflowId);
    return response.data;
  }

  /**
   * List all workflows.
   */
  async listWorkflows(): Promise<Workflow[]> {
    const response = await this.client.listWorkflows();
    return response.data;
  }

  /**
   * List all teams (groups in Shortcut API).
   */
  async listTeams(): Promise<ShortcutTeam[]> {
    const response = await this.client.listGroups();
    return response.data.map((g: Group) => ({
      id: g.id,
      name: g.name,
      mention_name: g.mention_name,
      workflow_ids: g.workflow_ids,
    }));
  }

  /**
   * Get a team by ID.
   */
  async getTeam(teamId: string): Promise<ShortcutTeam> {
    const response = await this.client.getGroup(teamId);
    const g = response.data;
    return {
      id: g.id,
      name: g.name,
      mention_name: g.mention_name,
      workflow_ids: g.workflow_ids,
    };
  }

  /**
   * Find a team by mention name.
   */
  async findTeamByMentionName(
    mentionName: string,
  ): Promise<ShortcutTeam | null> {
    const teams = await this.listTeams();
    return (
      teams.find(
        (t) => t.mention_name === mentionName || t.name === mentionName,
      ) || null
    );
  }

  /**
   * List all labels.
   */
  async listLabels(): Promise<Label[]> {
    const response = await this.client.listLabels();
    return response.data;
  }

  /**
   * Create a label if it doesn't exist.
   */
  async ensureLabel(name: string): Promise<Label> {
    const labels = await this.listLabels();
    const existing = labels.find((l) => l.name === name);
    if (existing) {
      return existing;
    }
    const response = await this.client.createLabel({ name });
    return response.data;
  }

  /**
   * Get the default "unstarted" state for a workflow.
   */
  async getDefaultUnstartedState(workflowId: number): Promise<number> {
    const workflow = await this.getWorkflow(workflowId);
    const unstartedState = workflow.states.find((s) => s.type === "unstarted");
    if (!unstartedState) {
      throw new Error(`No unstarted state found in workflow ${workflowId}`);
    }
    return unstartedState.id;
  }

  /**
   * Get the "done" state for a workflow.
   */
  async getDoneState(workflowId: number): Promise<number> {
    const workflow = await this.getWorkflow(workflowId);
    const doneState = workflow.states.find((s) => s.type === "done");
    if (!doneState) {
      throw new Error(`No done state found in workflow ${workflowId}`);
    }
    return doneState.id;
  }

  /**
   * Build the story URL from story ID.
   */
  async buildStoryUrl(storyId: number): Promise<string> {
    const workspace = await this.getWorkspaceSlug();
    return `https://app.shortcut.com/${workspace}/story/${storyId}`;
  }
}
