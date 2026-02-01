# Sync

How syncing works between local tasks and remote integrations (GitHub Issues, Shortcut Stories).

## Basic Sync

Push local task state to remote:

```bash
dex sync
```

This updates all tasks linked to GitHub or Shortcut. New tasks create issues/stories, existing ones are updated.

## Source of Truth

Local dex is the source of truth for task content (name, description, subtasks). However, sync uses **timestamps** to handle distributed workflows where the same task is edited on multiple machines.

### How Timestamps Work

Every task has an `updated_at` timestamp. When you sync:

1. Dex compares local `updated_at` with remote `updated_at` (stored in issue metadata)
2. If **remote is newer** → pull remote state to local
3. If **local is newer** → push local state to remote
4. If **equal** → skip (no changes)

This means if you complete a task on Machine A and sync, then run sync on Machine B (which has stale local state), Machine B will pull the completion from remote instead of overwriting it.

## What Gets Synced

### Pushed to Remote (local → remote)

- Task name → Issue title
- Task description → Issue body
- Completion state → Issue open/closed
- Subtasks → Rendered as checklist in issue body
- Metadata → Stored in HTML comments for round-trip

### Pulled from Remote (remote → local)

When remote is newer, these fields are pulled:

- `completed` status
- `completed_at` timestamp
- `result` (completion notes)
- `started_at` timestamp
- `commit` metadata (if present)

## Issue State Behavior

### Closing Issues

Issues are only closed when the task is completed **and** the work is verified:

- Task completed with `--commit <sha>` where SHA is merged to default branch → Closes
- Task completed with `--no-commit` → Stays open
- Task completed without commit metadata → Stays open

See [Task Completion](./task-completion.md) for details on commit verification.

### Never Reopening Closed Issues

If an issue is already closed on GitHub, sync will **never** reopen it, even if local state differs.

**Why?** This prevents accidents in distributed workflows:

- Machine A completes task, syncs → issue closes
- Machine B has stale local state (task incomplete)
- Machine B syncs → issue stays closed, local state is updated from remote

Without this protection, Machine B would reopen the issue that Machine A intentionally closed.

## Multi-Machine Workflows

Dex is designed for distributed use across multiple machines. The sync behavior ensures:

1. **Last write wins** - Based on `updated_at` timestamps
2. **No accidental reopening** - Closed issues stay closed
3. **Automatic reconciliation** - Stale local state is updated from remote

### Example: Completing on Different Machines

```
Machine A                           Machine B
─────────                           ─────────
dex complete abc --result "Done"    (task abc is incomplete locally)
dex sync
  → Issue #123 closes
                                    dex sync
                                      → Sees remote is newer
                                      → Pulls completion to local
                                      → Shows "1 pulled from remote"
```

## Sync Output

The sync summary shows what happened:

```
Synced to GitHub owner/repo
  (2 created, 5 updated, 1 pulled from remote, 10 unchanged)
```

- **created** - New issues/stories were created
- **updated** - Existing issues/stories were updated (local pushed to remote)
- **pulled from remote** - Local was updated from remote (remote was newer)
- **unchanged** - No changes needed

## Selective Sync

Sync a single task:

```bash
dex sync <task-id>
```

Sync only to a specific integration:

```bash
dex sync --github      # Only GitHub
dex sync --shortcut    # Only Shortcut
```

## Summary

| Scenario                 | Behavior                             |
| ------------------------ | ------------------------------------ |
| Local newer than remote  | Push local → remote                  |
| Remote newer than local  | Pull remote → local                  |
| Remote issue is closed   | Never reopen, update local if needed |
| Task has verified commit | Close issue on sync                  |
| Task has no commit       | Keep issue open                      |
