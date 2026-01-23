# Plan: Embed Subtasks in GitHub Issues

## Goal
Change GitHub Issues storage so subtasks are embedded within parent issue bodies (using collapsible markdown) rather than creating separate GitHub Issues for each one.

## Current Behavior
- Every task creates a separate GitHub Issue
- `parent_id` field exists in schema but is ignored (always `null`)

## Desired Behavior
- Parent tasks (no `parent_id`) → separate GitHub Issues
- Subtasks (have `parent_id`) → embedded in parent issue body as collapsible `<details>` blocks
- Subtask IDs use compound format: `{parentIssueNumber}-{localIndex}` (e.g., `9-1`, `9-2`)

## Markdown Format for Subtasks

```markdown
## Context
Parent task context here...

## Subtasks

<details>
<summary>[ ] Subtask description</summary>
<!-- dex:subtask:id:9-1 -->
<!-- dex:subtask:priority:5 -->
<!-- dex:subtask:status:pending -->
<!-- dex:subtask:created_at:2024-01-22T10:00:00Z -->

### Context
Subtask context here...

</details>

<details>
<summary>[x] Completed subtask</summary>
<!-- dex:subtask:id:9-2 -->
<!-- dex:subtask:priority:5 -->
<!-- dex:subtask:status:completed -->

### Context
...

### Result
Subtask result here...

</details>
```

## Implementation Steps

### 1. Create `src/core/subtask-markdown.ts` (new file)
Parsing/rendering helpers:
- `parseIssueBody(body)` → `{ context, subtasks[] }`
- `renderIssueBody(context, subtasks)` → markdown string
- `parseSubtaskId(id)` → `{ parentId, localIndex }` or null
- `createSubtaskId(parentId, index)` → compound ID string

### 2. Modify `src/core/github-issues-storage.ts`

**`issueToTask()`** - Extract only parent context (before `## Subtasks` section)

**`readAsync()`** - After converting issue to parent task, parse body for embedded subtasks and add them to tasks array with correct `parent_id` and compound IDs

**`writeAsync()`** - Partition tasks:
- Parents (no `parent_id`) → create/update as GitHub Issues
- Subtasks (have `parent_id`) → group by parent, embed in parent body
- Warn about orphaned subtasks (parent doesn't exist)

**New: `createIssueWithSubtasks(task, subtasks[])`** - Render body with embedded subtasks, create issue, update IDs

**New: `updateIssueWithSubtasks(task, subtasks[])`** - Fetch current issue, merge subtasks, update body

### 3. Add tests

**Unit tests** (`src/core/subtask-markdown.test.ts`):
- Parse body with/without subtasks
- Render subtasks with various states
- Round-trip parsing/rendering
- Handle malformed markdown gracefully

**Integration tests** (mock Octokit):
- Read parent with embedded subtasks
- Write parent + subtasks together
- Update subtask status/result
- Delete subtasks (remove from body)

## Files to Modify
- `src/core/github-issues-storage.ts` - main changes
- `src/core/subtask-markdown.ts` - new file

## Edge Cases
- **Orphaned subtasks**: Log warning, don't create orphan issues
- **Malformed markdown**: Graceful degradation, treat unparseable content as context
- **Nested subtasks**: Only support one level (subtask of subtask not allowed)
- **Moving subtasks**: Remove from old parent, add to new parent, update ID

## Verification
1. `pnpm build` - ensure TypeScript compiles
2. `pnpm test` - run all tests including new ones
3. Manual test with real GitHub repo:
   - Create parent task → verify GitHub Issue created
   - Create subtask → verify embedded in parent body, not separate issue
   - Complete subtask → verify checkbox updates to `[x]` and result section added
   - Read tasks → verify subtasks parsed back with correct IDs
   - Delete subtask → verify removed from parent body
