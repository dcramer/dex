/**
 * Schema Migration Tests
 *
 * These tests verify that dex can read data written by older versions.
 * Data compatibility is critical - users must never lose their tasks due to schema changes.
 *
 * IMPORTANT: These tests document our migration commitments. Once a migration is added,
 * it should NEVER be removed. Old data formats must remain readable forever.
 *
 * When adding new migrations:
 * 1. Add a new describe block documenting the change
 * 2. Include the version/date when the change was introduced
 * 3. Test both the old format parsing AND that all old field values are preserved
 */

import { describe, it, expect } from "vitest";
import {
  TaskSchema,
  ArchivedTaskSchema,
  ArchivedChildSchema,
} from "./types.js";

describe("TaskSchema migrations", () => {
  /**
   * Migration: status field → completed boolean
   * Introduced: v0.1.0 (initial release)
   *
   * Old format used `status: "pending" | "completed"` enum.
   * New format uses `completed: boolean` for simplicity.
   */
  describe("status → completed migration", () => {
    it("migrates status='pending' to completed=false", () => {
      const oldFormat = {
        id: "test-id",
        name: "Test task",
        description: "Description",
        status: "pending",
        priority: 1,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(oldFormat);

      expect(task.completed).toBe(false);
      expect(task).not.toHaveProperty("status");
    });

    it("migrates status='completed' to completed=true", () => {
      const oldFormat = {
        id: "test-id",
        name: "Test task",
        description: "Description",
        status: "completed",
        priority: 1,
        result: "Done",
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: "2024-01-01T01:00:00.000Z",
      };

      const task = TaskSchema.parse(oldFormat);

      expect(task.completed).toBe(true);
      expect(task).not.toHaveProperty("status");
    });

    it("preserves explicit completed field over status", () => {
      const mixedFormat = {
        id: "test-id",
        name: "Test task",
        description: "Description",
        status: "pending",
        completed: true, // Explicit completed takes precedence
        priority: 1,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(mixedFormat);

      expect(task.completed).toBe(true);
    });
  });

  /**
   * Migration: description/context → name/description
   * Introduced: v0.4.0 (January 2026)
   *
   * Old format:
   *   - description: one-line task title (like GitHub issue title)
   *   - context: detailed information (like GitHub issue body)
   *
   * New format:
   *   - name: one-line task title
   *   - description: detailed information
   *
   * This aligns with common terminology where "name" is a short identifier
   * and "description" contains full details.
   */
  describe("description/context → name/description migration", () => {
    it("migrates old description field to name", () => {
      const oldFormat = {
        id: "test-id",
        description: "Fix authentication bug", // Old: this was the title
        context: "Users are getting logged out unexpectedly", // Old: this was the details
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(oldFormat);

      expect(task.name).toBe("Fix authentication bug");
      expect(task.description).toBe(
        "Users are getting logged out unexpectedly",
      );
      expect(task).not.toHaveProperty("context");
    });

    it("handles missing context field (defaults to empty string)", () => {
      const oldFormat = {
        id: "test-id",
        description: "Quick fix", // Old title, no context
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(oldFormat);

      expect(task.name).toBe("Quick fix");
      expect(task.description).toBe("");
    });

    it("preserves new format when name field exists", () => {
      const newFormat = {
        id: "test-id",
        name: "New format task",
        description: "Full description here",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(newFormat);

      expect(task.name).toBe("New format task");
      expect(task.description).toBe("Full description here");
    });

    it("detects old format by presence of context field", () => {
      // Even if 'name' somehow exists, presence of 'context' triggers migration
      const ambiguousFormat = {
        id: "test-id",
        description: "Old title",
        context: "Old details",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(ambiguousFormat);

      expect(task.name).toBe("Old title");
      expect(task.description).toBe("Old details");
    });
  });

  /**
   * Migration: Add bidirectional blocking relationships
   * Introduced: v0.3.0
   *
   * Old format had no blocking fields.
   * New format adds blockedBy, blocks, and children arrays.
   */
  describe("blocking relationship fields migration", () => {
    it("adds default empty arrays for missing relationship fields", () => {
      const oldFormat = {
        id: "test-id",
        name: "Test task",
        description: "Description",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
        // No blockedBy, blocks, or children
      };

      const task = TaskSchema.parse(oldFormat);

      expect(task.blockedBy).toEqual([]);
      expect(task.blocks).toEqual([]);
      expect(task.children).toEqual([]);
    });

    it("preserves existing relationship fields", () => {
      const withRelationships = {
        id: "test-id",
        name: "Test task",
        description: "Description",
        priority: 1,
        completed: false,
        result: null,
        metadata: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
        blockedBy: ["blocker-1", "blocker-2"],
        blocks: ["blocked-1"],
        children: ["child-1"],
      };

      const task = TaskSchema.parse(withRelationships);

      expect(task.blockedBy).toEqual(["blocker-1", "blocker-2"]);
      expect(task.blocks).toEqual(["blocked-1"]);
      expect(task.children).toEqual(["child-1"]);
    });
  });

  /**
   * Combined migration test: Very old data format
   *
   * This tests data that might have been created in the earliest versions,
   * with multiple old field formats combined.
   */
  describe("combined migrations (oldest format)", () => {
    it("handles data from v0.1.0 with all old fields", () => {
      const veryOldFormat = {
        id: "legacy-task",
        parent_id: null,
        description: "Legacy task title", // Old name field
        context: "This is old context data", // Old description field
        status: "pending", // Old completed field
        priority: 3,
        result: null,
        metadata: null,
        created_at: "2023-06-01T00:00:00.000Z",
        updated_at: "2023-06-15T00:00:00.000Z",
        completed_at: null,
        // No relationship fields
      };

      const task = TaskSchema.parse(veryOldFormat);

      // Verify all migrations applied correctly
      expect(task.id).toBe("legacy-task");
      expect(task.name).toBe("Legacy task title");
      expect(task.description).toBe("This is old context data");
      expect(task.completed).toBe(false);
      expect(task.priority).toBe(3);
      expect(task.blockedBy).toEqual([]);
      expect(task.blocks).toEqual([]);
      expect(task.children).toEqual([]);

      // Verify old fields are not present
      expect(task).not.toHaveProperty("status");
      expect(task).not.toHaveProperty("context");
    });

    it("handles completed task from v0.1.0", () => {
      const veryOldCompleted = {
        id: "legacy-completed",
        parent_id: null,
        description: "Completed legacy task",
        context: "Was completed long ago",
        status: "completed",
        priority: 1,
        result: "Successfully migrated",
        metadata: {
          commit: {
            sha: "abc123",
            message: "feat: add feature",
          },
        },
        created_at: "2023-01-01T00:00:00.000Z",
        updated_at: "2023-01-02T00:00:00.000Z",
        completed_at: "2023-01-02T00:00:00.000Z",
      };

      const task = TaskSchema.parse(veryOldCompleted);

      expect(task.name).toBe("Completed legacy task");
      expect(task.description).toBe("Was completed long ago");
      expect(task.completed).toBe(true);
      expect(task.result).toBe("Successfully migrated");
      expect(task.metadata?.commit?.sha).toBe("abc123");
    });
  });

  describe("beads metadata compatibility", () => {
    it("accepts beads metadata on tasks", () => {
      const taskWithBeadsMetadata = {
        id: "beads-task-1",
        name: "Imported from Beads",
        description: "Imported description",
        priority: 2,
        completed: false,
        result: null,
        metadata: {
          beads: {
            issueId: "beads-task-1",
            status: "open",
            issueType: "task",
            blockerIds: ["beads-task-2"],
          },
        },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(taskWithBeadsMetadata);
      expect(task.metadata?.beads?.issueId).toBe("beads-task-1");
      expect(task.metadata?.beads?.status).toBe("open");
      expect(task.metadata?.beads?.blockerIds).toEqual(["beads-task-2"]);
    });

    it("preserves backward compatibility for tasks without beads metadata", () => {
      const taskWithoutBeads = {
        id: "legacy-no-beads",
        name: "Legacy task",
        description: "Still valid",
        priority: 1,
        completed: false,
        result: null,
        metadata: {
          github: {
            issueNumber: 42,
            issueUrl: "https://github.com/example/repo/issues/42",
            repo: "example/repo",
          },
        },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
      };

      const task = TaskSchema.parse(taskWithoutBeads);
      expect(task.metadata?.github?.issueNumber).toBe(42);
      expect(task.metadata?.beads).toBeUndefined();
    });
  });
});

describe("ArchivedTaskSchema migrations", () => {
  /**
   * ArchivedTask uses 'name' field (not 'description' for title).
   * This schema was introduced after the field rename, so it should
   * use the new naming convention.
   */
  describe("field naming", () => {
    it("uses name field for task title", () => {
      const archived = {
        id: "archived-1",
        parent_id: null,
        name: "Archived task",
        result: "Completed successfully",
        metadata: null,
        completed_at: "2024-01-01T00:00:00.000Z",
        archived_at: "2024-01-15T00:00:00.000Z",
        archived_children: [],
      };

      const task = ArchivedTaskSchema.parse(archived);

      expect(task.name).toBe("Archived task");
    });
  });
});

describe("ArchivedChildSchema migrations", () => {
  /**
   * ArchivedChild uses 'name' field for consistency with ArchivedTask.
   */
  describe("field naming", () => {
    it("uses name field for child title", () => {
      const child = {
        id: "child-1",
        name: "Archived child task",
        result: "Done",
      };

      const parsed = ArchivedChildSchema.parse(child);

      expect(parsed.name).toBe("Archived child task");
    });
  });
});
