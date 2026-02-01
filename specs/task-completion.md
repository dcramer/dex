# Task Completion

How task completion works from the user's perspective.

## Basic Completion

Complete a task by providing a result:

```bash
dex complete <id> --result "What was accomplished"
```

The task is marked as completed locally. If the task has a parent, dex hints when all sibling subtasks are complete.

## Completion with Remote Links (GitHub/Shortcut)

When a task is linked to a GitHub issue or Shortcut story, completion behavior changes to prevent premature issue closure.

### Leaf Tasks (no subtasks)

For tasks that have no subtasks and are linked to a remote issue, you must specify how the work was delivered:

```bash
# Code changes: link the commit
dex complete <id> --result "..." --commit <sha>

# No code changes: acknowledge explicitly
dex complete <id> --result "..." --no-commit
```

**Why?** This prevents accidentally closing GitHub issues before code is merged. The linked issue only closes when the commit is merged to the default branch.

### What "merged" means

A commit is considered merged when it's an ancestor of `origin/HEAD` (typically `main` or `master`). This means:

- Pushing to a feature branch does **not** close the issue
- Opening a pull request does **not** close the issue
- Only merging the PR to the default branch closes the issue

This is intentional - you don't want issues closing while code is still in review.

| Flag                            | Task Status | Remote Issue |
| ------------------------------- | ----------- | ------------ |
| `--commit <sha>` (on PR branch) | Completed   | Stays open   |
| `--commit <sha>` (merged)       | Completed   | Closes       |
| `--no-commit`                   | Completed   | Stays open   |

If you forget to specify, dex shows an error:

```
Error: Task is linked to GitHub issue #123.
  Use --commit <sha> to link a commit (closes issue when merged)
  Use --no-commit to complete without a commit (issue stays open)
```

### Parent Tasks (have subtasks)

Parent tasks don't require `--commit` or `--no-commit`. Their linked issues close only when ALL descendant subtasks have verified commits on remote.

This means:

- If any subtask was completed with `--no-commit`, the parent issue stays open
- If any subtask's commit hasn't been pushed yet, the parent issue stays open
- Only when every subtask has a pushed commit does the parent issue close

### Tasks Without Remote Links

Tasks not linked to GitHub or Shortcut can be completed with just `--result`:

```bash
dex complete <id> --result "Done"
```

No `--commit` or `--no-commit` required.

## Completion Requirements

Before completing a task:

1. **Subtasks must be complete** - Cannot complete a parent with pending children
2. **Blockers warn but don't prevent** - Completing a blocked task shows a warning but proceeds

## Syncing After Completion

Completion is a local operation. To update the remote issue/story state:

```bash
dex sync
```

The sync respects the completion rules above - issues only close when commits are verified on remote.

## Summary

| Scenario                    | Flags Required              | Issue Closes When               |
| --------------------------- | --------------------------- | ------------------------------- |
| Local task (no remote link) | None                        | N/A                             |
| Remote-linked leaf task     | `--commit` or `--no-commit` | Commit merged to default branch |
| Remote-linked parent task   | None                        | All descendant commits merged   |
| `--no-commit` completion    | Required for remote leaf    | Never (manual close)            |
