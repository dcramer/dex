import { describe, it, expect } from "vitest";
import type { Task, TaskStore } from "../types.js";
import {
  syncParentChild,
  syncAddBlocker,
  syncRemoveBlocker,
  cleanupTaskReferences,
  wouldCreateBlockingCycle,
  getIncompleteBlockerIds,
  isBlocked,
  hasIncompleteChildren,
  isReady,
  collectDescendantIds,
  isDescendant,
  collectAncestors,
  getDepthFromParent,
  getMaxDescendantDepth,
  getDepth,
  getChildren,
  getIncompleteBlockers,
  getBlockedTasks,
} from "./task-relationships.js";
import { NotFoundError } from "../errors.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? "task1",
    name: "Test task",
    description: "",
    completed: false,
    priority: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    blocks: [],
    blockedBy: [],
    children: [],
    parent_id: null,
    metadata: null,
    ...overrides,
  };
}

function createStore(tasks: Task[]): TaskStore {
  return { tasks };
}

describe("task-relationships", () => {
  describe("syncParentChild", () => {
    it("adds child to new parent's children array", () => {
      const parent = createTask({ id: "parent", children: [] });
      const child = createTask({ id: "child", parent_id: null });
      const store = createStore([parent, child]);

      syncParentChild(store, "child", null, "parent");

      expect(parent.children).toContain("child");
    });

    it("removes child from old parent's children array", () => {
      const oldParent = createTask({ id: "oldParent", children: ["child"] });
      const newParent = createTask({ id: "newParent", children: [] });
      const child = createTask({ id: "child", parent_id: "oldParent" });
      const store = createStore([oldParent, newParent, child]);

      syncParentChild(store, "child", "oldParent", "newParent");

      expect(oldParent.children).not.toContain("child");
      expect(newParent.children).toContain("child");
    });

    it("handles removing parent (setting to null)", () => {
      const parent = createTask({ id: "parent", children: ["child"] });
      const child = createTask({ id: "child", parent_id: "parent" });
      const store = createStore([parent, child]);

      syncParentChild(store, "child", "parent", null);

      expect(parent.children).not.toContain("child");
    });

    it("throws NotFoundError when new parent does not exist", () => {
      const child = createTask({ id: "child" });
      const store = createStore([child]);

      expect(() =>
        syncParentChild(store, "child", null, "nonexistent"),
      ).toThrow(NotFoundError);
    });

    it("does not duplicate child in parent's children array", () => {
      const parent = createTask({ id: "parent", children: ["child"] });
      const child = createTask({ id: "child", parent_id: "parent" });
      const store = createStore([parent, child]);

      // Call again with same parent
      syncParentChild(store, "child", null, "parent");

      expect(parent.children.filter((id) => id === "child")).toHaveLength(1);
    });

    it("handles old parent not existing gracefully", () => {
      const newParent = createTask({ id: "newParent", children: [] });
      const child = createTask({ id: "child" });
      const store = createStore([newParent, child]);

      // Old parent "ghost" doesn't exist - should not throw
      syncParentChild(store, "child", "ghost", "newParent");

      expect(newParent.children).toContain("child");
    });
  });

  describe("syncAddBlocker", () => {
    it("adds blocker to blocked task's blockedBy array", () => {
      const blocker = createTask({ id: "blocker" });
      const blocked = createTask({ id: "blocked" });
      const store = createStore([blocker, blocked]);

      syncAddBlocker(store, "blocker", "blocked");

      expect(blocked.blockedBy).toContain("blocker");
    });

    it("adds blocked to blocker's blocks array", () => {
      const blocker = createTask({ id: "blocker" });
      const blocked = createTask({ id: "blocked" });
      const store = createStore([blocker, blocked]);

      syncAddBlocker(store, "blocker", "blocked");

      expect(blocker.blocks).toContain("blocked");
    });

    it("throws NotFoundError when blocker does not exist", () => {
      const blocked = createTask({ id: "blocked" });
      const store = createStore([blocked]);

      expect(() => syncAddBlocker(store, "nonexistent", "blocked")).toThrow(
        NotFoundError,
      );
    });

    it("does not duplicate entries", () => {
      const blocker = createTask({ id: "blocker", blocks: ["blocked"] });
      const blocked = createTask({ id: "blocked", blockedBy: ["blocker"] });
      const store = createStore([blocker, blocked]);

      syncAddBlocker(store, "blocker", "blocked");

      expect(blocker.blocks.filter((id) => id === "blocked")).toHaveLength(1);
      expect(blocked.blockedBy.filter((id) => id === "blocker")).toHaveLength(
        1,
      );
    });

    it("handles blocked task not existing gracefully", () => {
      const blocker = createTask({ id: "blocker" });
      const store = createStore([blocker]);

      // Should not throw - blocked task might be created later
      syncAddBlocker(store, "blocker", "ghost");

      expect(blocker.blocks).toContain("ghost");
    });
  });

  describe("syncRemoveBlocker", () => {
    it("removes blocker from blocked task's blockedBy array", () => {
      const blocker = createTask({ id: "blocker", blocks: ["blocked"] });
      const blocked = createTask({ id: "blocked", blockedBy: ["blocker"] });
      const store = createStore([blocker, blocked]);

      syncRemoveBlocker(store, "blocker", "blocked");

      expect(blocked.blockedBy).not.toContain("blocker");
    });

    it("removes blocked from blocker's blocks array", () => {
      const blocker = createTask({ id: "blocker", blocks: ["blocked"] });
      const blocked = createTask({ id: "blocked", blockedBy: ["blocker"] });
      const store = createStore([blocker, blocked]);

      syncRemoveBlocker(store, "blocker", "blocked");

      expect(blocker.blocks).not.toContain("blocked");
    });

    it("handles missing blocker gracefully", () => {
      const blocked = createTask({ id: "blocked", blockedBy: ["ghost"] });
      const store = createStore([blocked]);

      // Should not throw
      syncRemoveBlocker(store, "ghost", "blocked");

      expect(blocked.blockedBy).not.toContain("ghost");
    });

    it("handles missing blocked task gracefully", () => {
      const blocker = createTask({ id: "blocker", blocks: ["ghost"] });
      const store = createStore([blocker]);

      // Should not throw
      syncRemoveBlocker(store, "blocker", "ghost");

      expect(blocker.blocks).not.toContain("ghost");
    });
  });

  describe("cleanupTaskReferences", () => {
    it("removes task from all children arrays", () => {
      const parent = createTask({
        id: "parent",
        children: ["deleted", "other"],
      });
      const deleted = createTask({ id: "deleted" });
      const store = createStore([parent, deleted]);

      cleanupTaskReferences(store, "deleted");

      expect(parent.children).toEqual(["other"]);
    });

    it("removes task from all blockedBy arrays", () => {
      const task = createTask({ id: "task", blockedBy: ["deleted", "other"] });
      const deleted = createTask({ id: "deleted" });
      const store = createStore([task, deleted]);

      cleanupTaskReferences(store, "deleted");

      expect(task.blockedBy).toEqual(["other"]);
    });

    it("removes task from all blocks arrays", () => {
      const task = createTask({ id: "task", blocks: ["deleted", "other"] });
      const deleted = createTask({ id: "deleted" });
      const store = createStore([task, deleted]);

      cleanupTaskReferences(store, "deleted");

      expect(task.blocks).toEqual(["other"]);
    });

    it("cleans up references across multiple tasks", () => {
      const task1 = createTask({
        id: "task1",
        children: ["deleted"],
        blocks: ["deleted"],
      });
      const task2 = createTask({
        id: "task2",
        blockedBy: ["deleted"],
      });
      const deleted = createTask({ id: "deleted" });
      const store = createStore([task1, task2, deleted]);

      cleanupTaskReferences(store, "deleted");

      expect(task1.children).not.toContain("deleted");
      expect(task1.blocks).not.toContain("deleted");
      expect(task2.blockedBy).not.toContain("deleted");
    });
  });

  describe("wouldCreateBlockingCycle", () => {
    it("returns false for simple non-cyclic case", () => {
      const taskA = createTask({ id: "A" });
      const taskB = createTask({ id: "B" });
      const tasks = [taskA, taskB];

      // A blocks B - no cycle
      expect(wouldCreateBlockingCycle(tasks, "A", "B")).toBe(false);
    });

    it("returns true for direct self-block", () => {
      const taskA = createTask({ id: "A" });
      const tasks = [taskA];

      // A blocks A - cycle
      expect(wouldCreateBlockingCycle(tasks, "A", "A")).toBe(true);
    });

    it("returns true for simple two-node cycle", () => {
      // A already blocks B, now trying to make B block A
      const taskA = createTask({ id: "A", blocks: ["B"] });
      const taskB = createTask({ id: "B", blockedBy: ["A"] });
      const tasks = [taskA, taskB];

      expect(wouldCreateBlockingCycle(tasks, "B", "A")).toBe(true);
    });

    it("returns true for three-node cycle", () => {
      // A -> B -> C (A blocks B, B blocks C)
      // Now trying to make C block A
      const taskA = createTask({ id: "A", blocks: ["B"] });
      const taskB = createTask({ id: "B", blockedBy: ["A"], blocks: ["C"] });
      const taskC = createTask({ id: "C", blockedBy: ["B"] });
      const tasks = [taskA, taskB, taskC];

      expect(wouldCreateBlockingCycle(tasks, "C", "A")).toBe(true);
    });

    it("returns false for valid chain extension", () => {
      // A -> B exists, adding B -> C is fine
      const taskA = createTask({ id: "A", blocks: ["B"] });
      const taskB = createTask({ id: "B", blockedBy: ["A"] });
      const taskC = createTask({ id: "C" });
      const tasks = [taskA, taskB, taskC];

      expect(wouldCreateBlockingCycle(tasks, "B", "C")).toBe(false);
    });

    it("handles complex diamond dependency without false positive", () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      // This is valid (no cycle)
      const taskA = createTask({ id: "A", blocks: ["B", "C"] });
      const taskB = createTask({ id: "B", blockedBy: ["A"], blocks: ["D"] });
      const taskC = createTask({ id: "C", blockedBy: ["A"], blocks: ["D"] });
      const taskD = createTask({ id: "D", blockedBy: ["B", "C"] });
      const tasks = [taskA, taskB, taskC, taskD];

      // Adding E blocked by D is fine
      const taskE = createTask({ id: "E" });
      tasks.push(taskE);

      expect(wouldCreateBlockingCycle(tasks, "D", "E")).toBe(false);
    });

    it("detects cycle in complex graph", () => {
      // A -> B -> C -> D, now D -> A would create cycle
      const taskA = createTask({ id: "A", blocks: ["B"] });
      const taskB = createTask({ id: "B", blockedBy: ["A"], blocks: ["C"] });
      const taskC = createTask({ id: "C", blockedBy: ["B"], blocks: ["D"] });
      const taskD = createTask({ id: "D", blockedBy: ["C"] });
      const tasks = [taskA, taskB, taskC, taskD];

      expect(wouldCreateBlockingCycle(tasks, "D", "A")).toBe(true);
    });

    it("handles inconsistent data (blocks without blockedBy)", () => {
      // Task A has B in blocks, but B doesn't have A in blockedBy
      const taskA = createTask({ id: "A", blocks: ["B"] });
      const taskB = createTask({ id: "B", blockedBy: [] }); // Inconsistent!
      const tasks = [taskA, taskB];

      // Should still detect cycle via blocks direction
      expect(wouldCreateBlockingCycle(tasks, "B", "A")).toBe(true);
    });

    it("handles missing tasks in chain gracefully", () => {
      // A references nonexistent B in blockedBy
      const taskA = createTask({ id: "A", blockedBy: ["ghost"] });
      const tasks = [taskA];

      // Should not throw, just return false
      expect(wouldCreateBlockingCycle(tasks, "A", "new")).toBe(false);
    });
  });

  describe("getIncompleteBlockerIds", () => {
    it("returns incomplete blockers", () => {
      const blocker1 = createTask({ id: "blocker1", completed: false });
      const blocker2 = createTask({ id: "blocker2", completed: true });
      const task = createTask({
        id: "task",
        blockedBy: ["blocker1", "blocker2"],
      });
      const tasks = [blocker1, blocker2, task];

      const result = getIncompleteBlockerIds(tasks, task);

      expect(result).toEqual(["blocker1"]);
    });

    it("returns empty array when all blockers complete", () => {
      const blocker = createTask({ id: "blocker", completed: true });
      const task = createTask({ id: "task", blockedBy: ["blocker"] });
      const tasks = [blocker, task];

      const result = getIncompleteBlockerIds(tasks, task);

      expect(result).toEqual([]);
    });

    it("returns empty array when no blockers", () => {
      const task = createTask({ id: "task", blockedBy: [] });
      const tasks = [task];

      const result = getIncompleteBlockerIds(tasks, task);

      expect(result).toEqual([]);
    });

    it("ignores blockers that no longer exist", () => {
      const task = createTask({ id: "task", blockedBy: ["ghost"] });
      const tasks = [task];

      const result = getIncompleteBlockerIds(tasks, task);

      expect(result).toEqual([]);
    });
  });

  describe("isBlocked", () => {
    it("returns true when task has incomplete blockers", () => {
      const blocker = createTask({ id: "blocker", completed: false });
      const task = createTask({ id: "task", blockedBy: ["blocker"] });
      const tasks = [blocker, task];

      expect(isBlocked(tasks, task)).toBe(true);
    });

    it("returns false when all blockers are complete", () => {
      const blocker = createTask({ id: "blocker", completed: true });
      const task = createTask({ id: "task", blockedBy: ["blocker"] });
      const tasks = [blocker, task];

      expect(isBlocked(tasks, task)).toBe(false);
    });

    it("returns false when no blockers", () => {
      const task = createTask({ id: "task", blockedBy: [] });
      const tasks = [task];

      expect(isBlocked(tasks, task)).toBe(false);
    });
  });

  describe("hasIncompleteChildren", () => {
    it("returns true when task has incomplete children", () => {
      const child = createTask({
        id: "child",
        completed: false,
        parent_id: "parent",
      });
      const parent = createTask({ id: "parent", children: ["child"] });
      const tasks = [parent, child];

      expect(hasIncompleteChildren(tasks, parent)).toBe(true);
    });

    it("returns false when all children are complete", () => {
      const child = createTask({
        id: "child",
        completed: true,
        parent_id: "parent",
      });
      const parent = createTask({ id: "parent", children: ["child"] });
      const tasks = [parent, child];

      expect(hasIncompleteChildren(tasks, parent)).toBe(false);
    });

    it("returns false when no children", () => {
      const task = createTask({ id: "task", children: [] });
      const tasks = [task];

      expect(hasIncompleteChildren(tasks, task)).toBe(false);
    });

    it("ignores children that no longer exist", () => {
      const parent = createTask({ id: "parent", children: ["ghost"] });
      const tasks = [parent];

      expect(hasIncompleteChildren(tasks, parent)).toBe(false);
    });
  });

  describe("isReady", () => {
    it("returns true for pending task with no blockers or children", () => {
      const task = createTask({ id: "task", completed: false });
      const tasks = [task];

      expect(isReady(tasks, task)).toBe(true);
    });

    it("returns false for completed task", () => {
      const task = createTask({ id: "task", completed: true });
      const tasks = [task];

      expect(isReady(tasks, task)).toBe(false);
    });

    it("returns false when blocked", () => {
      const blocker = createTask({ id: "blocker", completed: false });
      const task = createTask({ id: "task", blockedBy: ["blocker"] });
      const tasks = [blocker, task];

      expect(isReady(tasks, task)).toBe(false);
    });

    it("returns false when has incomplete children", () => {
      const child = createTask({
        id: "child",
        completed: false,
        parent_id: "parent",
      });
      const parent = createTask({ id: "parent", children: ["child"] });
      const tasks = [parent, child];

      expect(isReady(tasks, parent)).toBe(false);
    });

    it("returns true when blockers are complete and children are complete", () => {
      const blocker = createTask({ id: "blocker", completed: true });
      const child = createTask({
        id: "child",
        completed: true,
        parent_id: "task",
      });
      const task = createTask({
        id: "task",
        blockedBy: ["blocker"],
        children: ["child"],
      });
      const tasks = [blocker, child, task];

      expect(isReady(tasks, task)).toBe(true);
    });
  });

  describe("collectDescendantIds", () => {
    it("collects direct children", () => {
      const parent = createTask({
        id: "parent",
        children: ["child1", "child2"],
      });
      const child1 = createTask({ id: "child1", parent_id: "parent" });
      const child2 = createTask({ id: "child2", parent_id: "parent" });
      const tasks = [parent, child1, child2];

      const result = new Set<string>();
      collectDescendantIds(tasks, "parent", result);

      expect(result).toEqual(new Set(["child1", "child2"]));
    });

    it("collects nested descendants", () => {
      const grandparent = createTask({ id: "grandparent" });
      const parent = createTask({ id: "parent", parent_id: "grandparent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [grandparent, parent, child];

      const result = new Set<string>();
      collectDescendantIds(tasks, "grandparent", result);

      expect(result).toEqual(new Set(["parent", "child"]));
    });

    it("returns empty set for task with no children", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      const result = new Set<string>();
      collectDescendantIds(tasks, "task", result);

      expect(result.size).toBe(0);
    });

    it("handles circular references without infinite loop", () => {
      // This shouldn't happen in practice, but test defensive coding
      const task1 = createTask({ id: "task1", parent_id: "task2" });
      const task2 = createTask({ id: "task2", parent_id: "task1" });
      const tasks = [task1, task2];

      const result = new Set<string>();
      // Should not hang
      collectDescendantIds(tasks, "task1", result);

      // Result depends on iteration order, but should not throw
      expect(result.size).toBeLessThanOrEqual(2);
    });
  });

  describe("isDescendant", () => {
    it("returns true for direct child", () => {
      const parent = createTask({ id: "parent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [parent, child];

      expect(isDescendant(tasks, "child", "parent")).toBe(true);
    });

    it("returns true for grandchild", () => {
      const grandparent = createTask({ id: "grandparent" });
      const parent = createTask({ id: "parent", parent_id: "grandparent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [grandparent, parent, child];

      expect(isDescendant(tasks, "child", "grandparent")).toBe(true);
    });

    it("returns false for sibling", () => {
      const parent = createTask({ id: "parent" });
      const child1 = createTask({ id: "child1", parent_id: "parent" });
      const child2 = createTask({ id: "child2", parent_id: "parent" });
      const tasks = [parent, child1, child2];

      expect(isDescendant(tasks, "child1", "child2")).toBe(false);
    });

    it("returns false for ancestor (reverse direction)", () => {
      const parent = createTask({ id: "parent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [parent, child];

      expect(isDescendant(tasks, "parent", "child")).toBe(false);
    });

    it("returns false for unrelated tasks", () => {
      const task1 = createTask({ id: "task1" });
      const task2 = createTask({ id: "task2" });
      const tasks = [task1, task2];

      expect(isDescendant(tasks, "task1", "task2")).toBe(false);
    });

    it("returns false for nonexistent task", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(isDescendant(tasks, "ghost", "task")).toBe(false);
    });
  });

  describe("collectAncestors", () => {
    it("returns empty array for root task", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(collectAncestors(tasks, "task")).toEqual([]);
    });

    it("returns parent for direct child", () => {
      const parent = createTask({ id: "parent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [parent, child];

      const ancestors = collectAncestors(tasks, "child");

      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].id).toBe("parent");
    });

    it("returns ancestors from root to immediate parent", () => {
      const grandparent = createTask({ id: "grandparent" });
      const parent = createTask({ id: "parent", parent_id: "grandparent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [grandparent, parent, child];

      const ancestors = collectAncestors(tasks, "child");

      expect(ancestors).toHaveLength(2);
      expect(ancestors[0].id).toBe("grandparent");
      expect(ancestors[1].id).toBe("parent");
    });

    it("returns empty array when parent does not exist", () => {
      const child = createTask({ id: "child", parent_id: "ghost" });
      const tasks = [child];

      expect(collectAncestors(tasks, "child")).toEqual([]);
    });
  });

  describe("getDepthFromParent", () => {
    it("returns 1 for child of root", () => {
      const root = createTask({ id: "root" });
      const tasks = [root];

      expect(getDepthFromParent(tasks, "root")).toBe(1);
    });

    it("returns 2 for grandchild", () => {
      const grandparent = createTask({ id: "grandparent" });
      const parent = createTask({ id: "parent", parent_id: "grandparent" });
      const tasks = [grandparent, parent];

      expect(getDepthFromParent(tasks, "parent")).toBe(2);
    });

    it("returns 3 for great-grandchild", () => {
      const greatGrandparent = createTask({ id: "greatGrandparent" });
      const grandparent = createTask({
        id: "grandparent",
        parent_id: "greatGrandparent",
      });
      const parent = createTask({ id: "parent", parent_id: "grandparent" });
      const tasks = [greatGrandparent, grandparent, parent];

      expect(getDepthFromParent(tasks, "parent")).toBe(3);
    });
  });

  describe("getMaxDescendantDepth", () => {
    it("returns 0 for task with no children", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(getMaxDescendantDepth(tasks, "task")).toBe(0);
    });

    it("returns 1 for task with only direct children", () => {
      const parent = createTask({ id: "parent" });
      const child1 = createTask({ id: "child1", parent_id: "parent" });
      const child2 = createTask({ id: "child2", parent_id: "parent" });
      const tasks = [parent, child1, child2];

      expect(getMaxDescendantDepth(tasks, "parent")).toBe(1);
    });

    it("returns 2 for task with grandchildren", () => {
      const grandparent = createTask({ id: "grandparent" });
      const parent = createTask({ id: "parent", parent_id: "grandparent" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [grandparent, parent, child];

      expect(getMaxDescendantDepth(tasks, "grandparent")).toBe(2);
    });

    it("returns max depth across uneven branches", () => {
      const root = createTask({ id: "root" });
      const child1 = createTask({ id: "child1", parent_id: "root" });
      const child2 = createTask({ id: "child2", parent_id: "root" });
      const grandchild = createTask({ id: "grandchild", parent_id: "child1" });
      const tasks = [root, child1, child2, grandchild];

      // child1 branch has depth 2, child2 branch has depth 1
      expect(getMaxDescendantDepth(tasks, "root")).toBe(2);
    });
  });

  describe("getDepth", () => {
    it("returns 0 for root task", () => {
      const root = createTask({ id: "root" });
      const tasks = [root];

      expect(getDepth(tasks, "root")).toBe(0);
    });

    it("returns 1 for task under root", () => {
      const root = createTask({ id: "root" });
      const child = createTask({ id: "child", parent_id: "root" });
      const tasks = [root, child];

      expect(getDepth(tasks, "child")).toBe(1);
    });

    it("returns 2 for subtask", () => {
      const root = createTask({ id: "root" });
      const parent = createTask({ id: "parent", parent_id: "root" });
      const child = createTask({ id: "child", parent_id: "parent" });
      const tasks = [root, parent, child];

      expect(getDepth(tasks, "child")).toBe(2);
    });
  });

  describe("getChildren", () => {
    it("returns empty array for task with no children", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(getChildren(tasks, "task")).toEqual([]);
    });

    it("returns immediate children only", () => {
      const parent = createTask({ id: "parent" });
      const child1 = createTask({ id: "child1", parent_id: "parent" });
      const child2 = createTask({ id: "child2", parent_id: "parent" });
      const grandchild = createTask({ id: "grandchild", parent_id: "child1" });
      const tasks = [parent, child1, child2, grandchild];

      const children = getChildren(tasks, "parent");
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toEqual(["child1", "child2"]);
    });

    it("returns empty array for non-existent parent", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(getChildren(tasks, "nonexistent")).toEqual([]);
    });
  });

  describe("getIncompleteBlockers", () => {
    it("returns empty array for task with no blockers", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(getIncompleteBlockers(tasks, task)).toEqual([]);
    });

    it("returns incomplete blocking tasks", () => {
      const blocker = createTask({ id: "blocker", blocks: ["blocked"] });
      const blocked = createTask({
        id: "blocked",
        blockedBy: ["blocker"],
      });
      const tasks = [blocker, blocked];

      const blockers = getIncompleteBlockers(tasks, blocked);
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe("blocker");
    });

    it("excludes completed blockers", () => {
      const blocker = createTask({
        id: "blocker",
        completed: true,
        blocks: ["blocked"],
      });
      const blocked = createTask({
        id: "blocked",
        blockedBy: ["blocker"],
      });
      const tasks = [blocker, blocked];

      expect(getIncompleteBlockers(tasks, blocked)).toEqual([]);
    });

    it("returns multiple incomplete blockers", () => {
      const blocker1 = createTask({ id: "blocker1", blocks: ["blocked"] });
      const blocker2 = createTask({
        id: "blocker2",
        completed: true,
        blocks: ["blocked"],
      });
      const blocker3 = createTask({ id: "blocker3", blocks: ["blocked"] });
      const blocked = createTask({
        id: "blocked",
        blockedBy: ["blocker1", "blocker2", "blocker3"],
      });
      const tasks = [blocker1, blocker2, blocker3, blocked];

      const blockers = getIncompleteBlockers(tasks, blocked);
      expect(blockers).toHaveLength(2);
      expect(blockers.map((b) => b.id)).toEqual(["blocker1", "blocker3"]);
    });
  });

  describe("getBlockedTasks", () => {
    it("returns empty array for task blocking nothing", () => {
      const task = createTask({ id: "task" });
      const tasks = [task];

      expect(getBlockedTasks(tasks, task)).toEqual([]);
    });

    it("returns incomplete tasks being blocked", () => {
      const blocker = createTask({ id: "blocker", blocks: ["blocked"] });
      const blocked = createTask({
        id: "blocked",
        blockedBy: ["blocker"],
      });
      const tasks = [blocker, blocked];

      const blockedTasks = getBlockedTasks(tasks, blocker);
      expect(blockedTasks).toHaveLength(1);
      expect(blockedTasks[0].id).toBe("blocked");
    });

    it("excludes completed blocked tasks", () => {
      const blocker = createTask({ id: "blocker", blocks: ["blocked"] });
      const blocked = createTask({
        id: "blocked",
        completed: true,
        blockedBy: ["blocker"],
      });
      const tasks = [blocker, blocked];

      expect(getBlockedTasks(tasks, blocker)).toEqual([]);
    });

    it("returns multiple blocked tasks", () => {
      const blocker = createTask({
        id: "blocker",
        blocks: ["blocked1", "blocked2", "blocked3"],
      });
      const blocked1 = createTask({
        id: "blocked1",
        blockedBy: ["blocker"],
      });
      const blocked2 = createTask({
        id: "blocked2",
        completed: true,
        blockedBy: ["blocker"],
      });
      const blocked3 = createTask({
        id: "blocked3",
        blockedBy: ["blocker"],
      });
      const tasks = [blocker, blocked1, blocked2, blocked3];

      const blockedTasks = getBlockedTasks(tasks, blocker);
      expect(blockedTasks).toHaveLength(2);
      expect(blockedTasks.map((b) => b.id)).toEqual(["blocked1", "blocked3"]);
    });
  });
});
