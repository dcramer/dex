---
name: dex-plan
description: Create dex task from planning mode output. Use at end of planning session to persist plan as trackable work.
---

# Converting Plans to Tasks

Use `/dex-plan` at the end of a planning session to create a dex task from the plan file.

## When to Use

- After completing a plan in plan mode
- Plan is comprehensive and actionable
- Want to track plan execution as structured work

## Usage

```bash
/dex-plan <plan-file-path>
```

In plan mode, you know the plan file path from context (shown in system reminder). Example:

```bash
/dex-plan /home/user/.claude/plans/moonlit-brewing-lynx.md
```

## What It Does

1. Reads the plan markdown file
2. Extracts plan title (first `#` heading) as task description
3. Strips "Plan: " prefix if present (case-insensitive)
4. Uses full plan content as task context
5. Creates dex task
6. Returns task ID

## Example

If the plan file contains:
```markdown
# Plan: Add JWT Authentication

## Summary
...
```

The resulting task will have:
- **Description**: "Add JWT Authentication" (note: "Plan: " prefix stripped)
- **Context**: (full plan content)

## Options

```bash
/dex-plan <file> --priority 2              # Set priority
/dex-plan <file> --parent abc123           # Create as subtask
```

## After Creating

Once created, you can:
- View: `dex show <task-id>`
- Create subtasks: `dex create --parent <task-id> -d "..." --context "..."`
- Track progress through implementation
- Complete: `dex complete <task-id> --result "..."`

## When NOT to Use

- Plan is incomplete or exploratory
- Plan is just notes, not actionable
- Plan hasn't been saved to disk yet
