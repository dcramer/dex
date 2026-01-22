---
name: dex
description: Manage tasks via dex CLI. Use when breaking down complex work, tracking implementation items, or persisting context across sessions.
---

# Task Management

Use the `dex` CLI to track and manage work items during complex tasks.

## When to Create Tasks

Create tasks when:
- Breaking down complex work into discrete steps
- Tracking implementation items that span multiple interactions
- Recording context that needs to persist across sessions

## CLI Usage

### Create a Task

```bash
dex create -d "Short description" --context "Full implementation context"
```

Options:
- `-d, --description` (required): One-line summary
- `--context` (required): Full implementation details
- `--project <name>`: Group related tasks
- `-p, --priority <n>`: Lower = higher priority (default: 1)

Example:
```bash
dex create -d "Add user authentication" \
  --context "Implement JWT-based auth with refresh tokens. Use bcrypt for password hashing. Add /login and /register endpoints." \
  --project "auth" \
  -p 0
```

### List Tasks

```bash
dex list                      # Show pending tasks (default)
dex list --all                # Include completed
dex list --status completed   # Only completed
dex list --project "auth"     # Filter by project
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

Always include a meaningful result describing:
- What was implemented
- Key decisions made
- Any follow-up items identified

Example:
```bash
dex complete abc123 --result "Implemented JWT auth with 15min access tokens and 7-day refresh tokens. Added rate limiting to login endpoint. Follow-up: add email verification"
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

Use subtasks to break complex work into smaller, trackable pieces.

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

### List Projects

```bash
dex projects
```

## Best Practices

1. **Write clear descriptions**: Use action verbs ("Add", "Fix", "Update")
2. **Provide rich context**: Include requirements, constraints, and approach
3. **Use projects**: Group related tasks for better organization
4. **Set priorities**: Use priority 0 for urgent items
5. **Complete with results**: Document what was done for future reference

## Storage

Tasks are stored in:
- `<git-root>/.dex/tasks.json` (if in a git repo)
- `~/.dex/tasks.json` (fallback)

Override with `--storage-path` or `DEX_STORAGE_PATH` env var.
