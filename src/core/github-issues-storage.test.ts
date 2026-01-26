import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitHubIssuesStorage } from "./storage/index.js";
import { TaskStore } from "../types.js";
import { StorageError } from "../errors.js";
import {
  setupGitHubMock,
  cleanupGitHubMock,
  createIssueFixture,
  createTask,
  GitHubMock,
} from "../test-utils/github-mock.js";

describe("GitHubIssuesStorage", () => {
  let storage: GitHubIssuesStorage;
  let githubMock: GitHubMock;

  beforeEach(() => {
    githubMock = setupGitHubMock();
    storage = new GitHubIssuesStorage({
      owner: "test-owner",
      repo: "test-repo",
      token: "test-token",
    });
  });

  afterEach(() => {
    cleanupGitHubMock();
  });

  describe("synchronous operations", () => {
    it("read() throws StorageError explaining async requirement", () => {
      expect(() => storage.read()).toThrow(StorageError);
      expect(() => storage.read()).toThrow(/async/i);
    });

    it("write() throws StorageError explaining async requirement", () => {
      const store: TaskStore = { tasks: [] };

      expect(() => storage.write(store)).toThrow(StorageError);
      expect(() => storage.write(store)).toThrow(/async/i);
    });
  });

  describe("readAsync error scenarios", () => {
    describe("401 unauthorized", () => {
      it("throws StorageError with helpful message", async () => {
        githubMock.listIssues401("test-owner", "test-repo");

        try {
          await storage.readAsync();
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).message).toContain("Failed to read from GitHub Issues");
          expect((err as StorageError).message).toContain("test-owner/test-repo");
          expect((err as StorageError).suggestion).toContain("token permissions");
        }
      });
    });

    describe("403 forbidden", () => {
      it("throws StorageError when access denied", async () => {
        githubMock.listIssues403("test-owner", "test-repo", false);

        try {
          await storage.readAsync();
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).message).toContain("Failed to read");
        }
      });

      it("throws StorageError when rate limited", async () => {
        githubMock.listIssues403("test-owner", "test-repo", true);

        try {
          await storage.readAsync();
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).message).toContain("Failed to read");
        }
      });
    });

    describe("404 not found", () => {
      it("throws StorageError when repo not found", async () => {
        githubMock.listIssues404("test-owner", "test-repo");

        try {
          await storage.readAsync();
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).message).toContain("Failed to read");
        }
      });
    });

    describe("500 server error", () => {
      it("throws StorageError with cause on server error", async () => {
        githubMock.listIssues500("test-owner", "test-repo");

        try {
          await storage.readAsync();
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).cause).toBeDefined();
        }
      });
    });

    describe("successful read", () => {
      it("returns empty task store for no issues", async () => {
        githubMock.listIssues("test-owner", "test-repo", []);

        const result = await storage.readAsync();

        expect(result.tasks).toHaveLength(0);
      });

      it("parses issues into tasks", async () => {
        githubMock.listIssues("test-owner", "test-repo", [
          createIssueFixture({
            number: 1,
            title: "Task One",
            body: "Context for task one",
            state: "open",
            labels: [{ name: "dex" }, { name: "dex:priority-2" }],
          }),
          createIssueFixture({
            number: 2,
            title: "Task Two",
            body: "Context for task two",
            state: "closed",
            labels: [{ name: "dex" }],
          }),
        ]);

        const result = await storage.readAsync();

        expect(result.tasks).toHaveLength(2);
        expect(result.tasks[0].description).toBe("Task One");
        expect(result.tasks[0].priority).toBe(2);
        expect(result.tasks[0].completed).toBe(false);
        expect(result.tasks[1].description).toBe("Task Two");
        expect(result.tasks[1].completed).toBe(true);
      });

      it("skips pull requests", async () => {
        githubMock.listIssues("test-owner", "test-repo", [
          createIssueFixture({
            number: 1,
            title: "Real Issue",
            state: "open",
          }),
          {
            ...createIssueFixture({ number: 2, title: "Pull Request" }),
            pull_request: { url: "https://github.com/..." },
          },
        ]);

        const result = await storage.readAsync();

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].description).toBe("Real Issue");
      });
    });
  });

  describe("writeAsync error scenarios", () => {
    describe("401 unauthorized during list", () => {
      it("throws StorageError with repo scope suggestion", async () => {
        const store: TaskStore = { tasks: [createTask()] };
        githubMock.listIssues401("test-owner", "test-repo");

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).message).toContain("Failed to write");
          expect((err as StorageError).suggestion).toContain("repo scope");
        }
      });
    });

    describe("401 unauthorized during create", () => {
      it("throws StorageError when creating issue fails", async () => {
        const task = createTask({ id: "new-task" });
        const store: TaskStore = { tasks: [task] };

        // List existing issues (none)
        githubMock.listIssues("test-owner", "test-repo", []);
        // Create fails with 401
        githubMock.createIssue401("test-owner", "test-repo");

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).message).toContain("Failed to write");
        }
      });
    });

    describe("403 forbidden during create", () => {
      it("throws StorageError when lacking write permissions", async () => {
        const task = createTask({ id: "new-task" });
        const store: TaskStore = { tasks: [task] };

        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue403("test-owner", "test-repo", false);

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
        }
      });

      it("throws StorageError when rate limited during create", async () => {
        const task = createTask({ id: "new-task" });
        const store: TaskStore = { tasks: [task] };

        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue403("test-owner", "test-repo", true);

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
        }
      });
    });

    describe("500 server error during create", () => {
      it("throws StorageError on server error", async () => {
        const task = createTask({ id: "new-task" });
        const store: TaskStore = { tasks: [task] };

        githubMock.listIssues("test-owner", "test-repo", []);
        githubMock.createIssue500("test-owner", "test-repo");

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
          expect((err as StorageError).cause).toBeDefined();
        }
      });
    });

    describe("errors during update", () => {
      it("throws StorageError on 401 during update", async () => {
        // Task with ID matching existing issue
        const task = createTask({ id: "1", description: "Updated Title" });
        const store: TaskStore = { tasks: [task] };

        // List shows existing issue
        githubMock.listIssues("test-owner", "test-repo", [
          createIssueFixture({ number: 1, title: "Original Title" }),
        ]);
        // Get issue to check current state
        githubMock.getIssue("test-owner", "test-repo", 1, createIssueFixture({
          number: 1,
          title: "Original Title",
        }));
        // Update fails
        githubMock.updateIssue401("test-owner", "test-repo", 1);

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
        }
      });

      it("throws StorageError on 404 during update", async () => {
        const task = createTask({ id: "1", description: "Updated Title" });
        const store: TaskStore = { tasks: [task] };

        githubMock.listIssues("test-owner", "test-repo", [
          createIssueFixture({ number: 1, title: "Original Title" }),
        ]);
        githubMock.getIssue("test-owner", "test-repo", 1, createIssueFixture({
          number: 1,
          title: "Original Title",
        }));
        githubMock.updateIssue404("test-owner", "test-repo", 1);

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
        }
      });

      it("throws StorageError on 500 during update", async () => {
        const task = createTask({ id: "1", description: "Updated Title" });
        const store: TaskStore = { tasks: [task] };

        githubMock.listIssues("test-owner", "test-repo", [
          createIssueFixture({ number: 1, title: "Original Title" }),
        ]);
        githubMock.getIssue("test-owner", "test-repo", 1, createIssueFixture({
          number: 1,
          title: "Original Title",
        }));
        githubMock.updateIssue500("test-owner", "test-repo", 1);

        try {
          await storage.writeAsync(store);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(StorageError);
        }
      });
    });
  });

  describe("storage metadata", () => {
    it("getIdentifier returns owner/repo format", () => {
      expect(storage.getIdentifier()).toBe("test-owner/test-repo");
    });

    it("isSync returns false (requires async)", () => {
      expect(storage.isSync()).toBe(false);
    });
  });

  describe("error message quality", () => {
    it("includes repository information in error messages", async () => {
      githubMock.listIssues500("test-owner", "test-repo");

      try {
        await storage.readAsync();
        expect.fail("Should have thrown");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain("test-owner");
        expect(message).toContain("test-repo");
      }
    });

    it("includes actionable suggestion in error", async () => {
      githubMock.listIssues401("test-owner", "test-repo");

      try {
        await storage.readAsync();
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as StorageError).suggestion).toBeDefined();
        expect((err as StorageError).suggestion).toBeTruthy();
      }
    });

    it("preserves original error as cause", async () => {
      githubMock.listIssues500("test-owner", "test-repo");

      try {
        await storage.readAsync();
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as StorageError).cause).toBeInstanceOf(Error);
      }
    });
  });

  describe("subtask handling on errors", () => {
    it("handles orphaned subtasks gracefully with warning", async () => {
      // Create a subtask whose parent doesn't exist
      const subtask = createTask({
        id: "sub1",
        parent_id: "nonexistent-parent",
        description: "Orphaned Subtask",
      });
      const store: TaskStore = { tasks: [subtask] };

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // List shows no existing issues
      githubMock.listIssues("test-owner", "test-repo", []);

      await storage.writeAsync(store);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("non-existent parent")
      );

      warnSpy.mockRestore();
    });
  });

  describe("state consistency after failures", () => {
    it("does not corrupt local state on write failure", async () => {
      const task = createTask({ id: "1" });
      const originalStore: TaskStore = { tasks: [task] };

      githubMock.listIssues("test-owner", "test-repo", []);
      githubMock.createIssue500("test-owner", "test-repo");

      // Store a copy to verify it wasn't modified
      const taskCopy = { ...task };

      try {
        await storage.writeAsync(originalStore);
        expect.fail("Should have thrown");
      } catch {
        // Verify original task wasn't corrupted
        expect(originalStore.tasks[0].id).toBe(taskCopy.id);
        expect(originalStore.tasks[0].description).toBe(taskCopy.description);
      }
    });
  });
});
