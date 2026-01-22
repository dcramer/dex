---
name: dex
description: Manage tasks via dex CLI. Use when breaking down complex work, tracking implementation items, or persisting context across sessions.
---

# Task Management

Use the `dex` CLI to track and manage work items during complex tasks.

## When to Create Tasks

Create tasks when:
- Work requires 3+ discrete, non-trivial steps
- Implementation spans multiple sessions or interactions
- Context needs to persist (decisions, constraints, progress)
- You need to track dependencies between work items

Skip task creation when:
- Work is a single atomic action
- Everything fits in one session with no follow-up
- Overhead of tracking exceeds value

## CLI Usage

### Create a Task

```bash
dex create -d "Short description" --context "Full implementation context"
```

Options:
- `-d, --description` (required): One-line summary
- `--context` (required): Full implementation details
- `-p, --priority <n>`: Lower = higher priority (default: 1)

Context should include:
- Requirements and constraints
- Technical approach
- Acceptance criteria (what "done" looks like)
- Related files or dependencies

Example:
```bash
dex create -d "Add user authentication" \
  --context "Requirements:
- JWT-based auth with refresh tokens
- bcrypt for password hashing
- Rate limiting on login endpoint

Approach:
- Add /login and /register endpoints
- Store refresh tokens in DB
- 15min access token, 7-day refresh

Done when:
- Users can register, login, logout
- Tokens refresh automatically
- Tests cover auth flows"
```

### List Tasks

```bash
dex list                      # Show pending tasks (default)
dex list --all                # Include completed
dex list --status completed   # Only completed
dex list --query "login"      # Search in description/context
```

### View Task Details

```bash
dex show <id>
```

### Complete a Task

```bash
dex complete <id> --result "What was accomplished"
```

Result should include:
- What was implemented (specifics)
- Key decisions and rationale
- Any follow-up items or tech debt

Example:
```bash
dex complete abc123 --result "Implemented JWT auth:
- Added /login, /register, /logout endpoints
- Using bcrypt with cost=12 for passwords
- Access tokens: 15min, refresh: 7 days
- Added rate limiting: 5 attempts per minute

Decisions:
- Chose JWT over sessions for stateless scaling
- Stored refresh tokens in Redis for fast lookup

Follow-up:
- Add email verification (created task xyz789)
- Consider 2FA support"
```

### Edit a Task

```bash
dex edit <id> -d "Updated description" --context "Updated context"
```

### Delete a Task

```bash
dex delete <id>
```

Note: Deleting a parent task also deletes all its subtasks.

## Subtasks

Break complex work into subtasks when:
- Work naturally decomposes into 3+ discrete steps
- You want to track progress through a larger effort
- Subtasks could be worked on independently

Don't use subtasks when:
- Task is simple/atomic (one step)
- You'd only have 1-2 subtasks (just make separate tasks)

### Creating Subtasks

```bash
dex create -d "Implement login form" --context "..." --parent <parent-id>
```

### Viewing Subtasks

- `dex list` displays tasks as a tree (use `--flat` for plain list)
- `dex show <id>` includes subtask count

### Completion Rules

- A task cannot be completed while it has pending subtasks
- Complete all children before completing the parent

## Best Practices

1. **Right-size tasks**: Completable in one focused session
2. **Clear completion criteria**: Context should define "done"
3. **Don't over-decompose**: 3-7 subtasks per parent is usually right
4. **Action-oriented descriptions**: Start with verbs ("Add", "Fix", "Update")
5. **Document results**: Record what was done and any follow-ups

## Storage

Tasks are stored in:
- `<git-root>/.dex/tasks.json` (if in a git repo)
- `~/.dex/tasks.json` (fallback)

Override with `--storage-path` or `DEX_STORAGE_PATH` env var.
